import AxeBuilder from '@axe-core/playwright';
import type { Locator, Page, Route } from '@playwright/test';
import { finishedProfile } from '../src/testing/intake-fixtures';
import { personFacing } from './axe-target-size';
import {
  expect,
  expectNoHorizontalOverflow,
  json,
  mockSession,
  mockSignedOut,
  NO_WEBSITE_SETTINGS,
  SIGNED_IN_USER,
  test,
  waitForFonts,
} from './support';

/**
 * The client's Me page (M8) and the installable app (R2.5c) in a real browser: the page itself, the
 * two preferences that save on the account, the install offers, the manifest and the launch screen.
 * Every API call is a per-test mock; guards, interceptors and stores run unchanged.
 */
const ATLAS = {
  tenantId: '00000000-0000-4000-8000-000000000003',
  tenantName: 'Atlas Performance',
  tenantSlug: 'atlas-performance',
  role: 'Client',
};
const BARBELL = {
  ...ATLAS,
  tenantId: '00000000-0000-4000-8000-000000000004',
  tenantName: 'Beirut Barbell',
  tenantSlug: 'beirut-barbell',
};
const MAYA = {
  ...SIGNED_IN_USER,
  id: '00000000-0000-4000-8000-0000000000bb',
  email: 'maya@example.test',
  displayName: 'Maya Rahman',
  preferredWeightUnit: 'Kilogram',
};
const FEATURES = ['Training', 'Nutrition', 'CheckIns', 'Messaging', 'ResourceLibrary'];
const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const INSTALL = 'Add TB Gym to your home screen';

type User = typeof MAYA;
type Handler = (route: Route) => Promise<void> | void;

/** A signed-in client, with the reads Me makes answered. */
async function mockClient(
  page: Page,
  options: {
    user?: Partial<User>;
    memberships?: (typeof ATLAS)[];
    messaging?: 'Granted' | 'NoEntitlement';
    extra?: Record<string, Handler>;
  } = {},
) {
  const user: User = { ...MAYA, ...options.user };
  await mockSession(page, {
    memberships: options.memberships ?? [ATLAS],
    user,
    extra: {
      'GET /api/client-access/me': (route) =>
        json(
          route,
          200,
          FEATURES.map((feature) => ({
            feature,
            isAllowed: feature !== 'Messaging' || options.messaging !== 'NoEntitlement',
            reason:
              feature === 'Messaging' && options.messaging === 'NoEntitlement'
                ? 'NoEntitlement'
                : 'Granted',
          })),
        ),
      // The client's own profile comes first: a coach's client is not self-directed (notes plan N9a2).
      'GET /api/client-profile/me': (route) => json(route, 200, finishedProfile()),
      'GET /api/client-profile/me/coach': (route) =>
        json(route, 200, { name: 'Lea Haddad', foundingCoach: false }),
      ...(options.extra ?? {}),
    },
  });
  return user;
}

async function openMe(
  page: Page,
  options: Parameters<typeof mockClient>[1] & { width?: number; height?: number } = {},
) {
  await page.setViewportSize({ width: options.width ?? 390, height: options.height ?? 844 });
  const user = await mockClient(page, options);
  await page.goto('/me');
  await expect(page.getByRole('heading', { name: 'Me', level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { name: user.displayName, level: 2 })).toBeVisible();
  await waitForFonts(page);
}

async function expectNoAxeViolations(page: Page) {
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

/** What Chrome fires when a page can be installed; `outcome` is what the person then chooses. */
async function offerInstall(page: Page, outcome: 'accepted' | 'dismissed' = 'accepted') {
  await page.evaluate((choice) => {
    const marks = window as unknown as { prompted: number };
    marks.prompted = 0;
    const event = new Event('beforeinstallprompt', { cancelable: true });
    Object.assign(event, {
      prompt: () => {
        marks.prompted += 1;
        return Promise.resolve();
      },
      userChoice: Promise.resolve({ outcome: choice }),
    });
    window.dispatchEvent(event);
  }, outcome);
}

const prompted = (page: Page) =>
  page.evaluate(() => (window as unknown as { prompted: number }).prompted);

for (const [width, height] of [
  [390, 844],
  [1440, 900],
] as const) {
  test(`Me at ${width}px shows who you are, your coach and your settings`, async ({ page }) => {
    await openMe(page, { width, height });

    await expect(page).toHaveTitle('Me | TB Gym');
    await expect(page.getByRole('heading', { name: 'Me', level: 1 })).toBeFocused();
    await expect(page.locator('app-avatar').first()).toHaveText('MR');
    await expect(page.getByText('maya@example.test')).toBeVisible();
    await expect(page.getByRole('link', { name: /Your coach.*Lea Haddad/ })).toHaveAttribute(
      'href',
      '/messages',
    );
    await expect(page.getByRole('link', { name: /My plan/ })).toHaveAttribute('href', '/plan');
    await expect(page.getByRole('link', { name: /My profile/ })).toHaveAttribute(
      'href',
      '/profile',
    );
    await expect(page.getByRole('link', { name: /Notifications/ })).toHaveAttribute(
      'href',
      '/notifications/settings',
    );
    await expect(page.getByRole('link', { name: /Password and security/ })).toHaveAttribute(
      'href',
      '/account/security',
    );
    await expect(page.getByRole('radio', { name: 'Device' })).toBeChecked();
    await expect(page.getByRole('radio', { name: 'kg' })).toBeChecked();
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
    // One coach: nothing to switch between.
    await expect(page.getByRole('heading', { name: 'Your coaches' })).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
    await expectNoAxeViolations(page);
    await page.screenshot({ path: `test-results/r25c-me-${width}.png`, fullPage: true });
  });
}

// Notes plan N3b: a coach without the Founding coach badge draws Me's card exactly as before the
// badge existed. These baselines were taken on the tree before N3b changed the card; look before
// accepting a new one.
for (const [width, height, mode] of [
  [390, 844, 'system'],
  [1440, 900, 'system'],
  [390, 844, 'dark'],
] as const) {
  test(`a coach without the badge draws Me's card as before at ${width}px, ${mode}`, async ({
    page,
  }) => {
    await openMe(page, { width, height, user: { preferredThemeMode: mode } });
    await expect(page.getByRole('link', { name: /Your coach.*Lea Haddad/ })).toBeVisible();
    await expect(page.locator('.hero')).toHaveScreenshot(`me-coach-card-${width}-${mode}.png`);
  });
}

test('Me follows dark mode, because dark mode is chosen here', async ({ page }) => {
  await openMe(page, { user: { preferredThemeMode: 'dark' } });

  await expect(page.locator('html')).toHaveAttribute('data-mode', 'dark');
  await expect(page.locator('main')).not.toHaveAttribute('data-mode', 'light');
  const surface = await page
    .locator('.rows')
    .first()
    .evaluate((rows) => getComputedStyle(rows).backgroundColor);
  expect(surface).toBe('rgb(22, 30, 27)');
  await expect(page.getByRole('radio', { name: 'Dark' })).toBeChecked();
  await expectNoHorizontalOverflow(page);
  await expectNoAxeViolations(page);
  await page.screenshot({ path: 'test-results/r25c-me-dark-390.png', fullPage: true });
});

/** A client's own plans (critique B10a), as `GET /api/client-plan/me` answers. */
const ONLINE_COACHING = {
  id: '00000000-0000-4000-8000-0000000000c1',
  name: 'Online Coaching',
  optionLabel: '12 weeks',
  description:
    'Your own program, a weekly check-in and direct chat with your coach.\nAsk me anything.',
  startDate: '2026-10-05',
  lastDay: '2026-12-27',
  cancelledOn: null,
  status: 'Active',
  features: ['Training', 'Nutrition', 'CheckIns', 'Messaging'],
};

/** A session pack (critique B10c), with what it holds and what happened to each session. */
const PERSONAL_TRAINING = {
  ...ONLINE_COACHING,
  id: '00000000-0000-4000-8000-0000000000c3',
  name: 'Personal training',
  optionLabel: '10 sessions',
  description: null,
  startDate: '2026-10-01',
  lastDay: '2026-12-29',
  features: ['Sessions'],
  sessions: {
    count: 10,
    left: 7,
    used: 3,
    lapsed: 0,
    lapsedOn: null,
    sessions: [
      { day: '2026-10-14', outcome: 'Held', reason: null },
      { day: '2026-10-09', outcome: 'Charged', reason: 'No-show: you didn’t come' },
      { day: '2026-10-06', outcome: 'Held', reason: null },
    ],
  },
};

/** The client's renewal state (critique B14), as `GET /api/client-plan/me` carries it. */
const ASK = {
  planEnded: false,
  endedOn: null,
  endsOn: '2026-10-17',
  planId: ONLINE_COACHING.id,
  coachName: 'Hicham Haddad',
  lastRequest: null,
  canAsk: true,
};

async function openPlan(
  page: Page,
  plans: object[],
  options: Parameters<typeof mockClient>[1] & {
    width?: number;
    height?: number;
    renewal?: object;
  } = {},
) {
  await page.setViewportSize({ width: options.width ?? 390, height: options.height ?? 844 });
  await mockClient(page, {
    ...options,
    extra: {
      'GET /api/client-plan/me': (route) =>
        json(route, 200, {
          today: '2026-10-15',
          plans,
          coachName: 'Hicham Haddad',
          renewal: options.renewal ?? null,
        }),
      'POST /api/client-renewal/me/requests': (route) =>
        json(route, 201, {
          ...options.renewal,
          canAsk: false,
          lastRequest: { id: 'request', requestedOn: '2026-10-15', askAgainFrom: '2026-10-22' },
        }),
    },
  });
  await page.goto('/plan');
  await expect(page.getByRole('heading', { name: 'My plan', level: 1 })).toBeVisible();
  await waitForFonts(page);
}

for (const [width, height] of [
  [390, 844],
  [1440, 900],
] as const) {
  test(`My plan at ${width}px reads the plan`, async ({ page }) => {
    await openPlan(page, [ONLINE_COACHING], { width, height });

    await expect(page).toHaveTitle('My plan | TB Gym');
    await expect(page.getByRole('heading', { name: 'My plan', level: 1 })).toBeFocused();
    const plan = page.getByRole('region', { name: 'Online Coaching' });
    await expect(plan.getByText('Active · 73 days left')).toBeVisible();
    await expect(plan.getByText('12 weeks · Mon 5 Oct – Sun 27 Dec')).toBeVisible();
    await expect(plan.getByRole('listitem')).toHaveText([
      'Training',
      'Nutrition',
      'Check-ins',
      'Messaging',
    ]);
    await expect(plan.getByRole('heading', { name: 'About this plan' })).toBeVisible();
    await expect(plan.getByText('Ask me anything.')).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await expectNoAxeViolations(page);
    await page.screenshot({ path: `test-results/b10a-plan-${width}.png`, fullPage: true });
  });
}

for (const [width, height] of [
  [390, 844],
  [1440, 900],
] as const) {
  test(`My plan at ${width}px says what is left on a pack and what happened`, async ({ page }) => {
    await openPlan(page, [PERSONAL_TRAINING], { width, height });

    const pack = page.getByRole('region', { name: 'Personal training' });
    await expect(
      pack.getByText('7 of 10 sessions with Hicham left, until 29 December'),
    ).toBeVisible();
    await expect(pack.getByRole('heading', { name: 'Sessions so far' })).toBeVisible();
    await expect(pack.locator('.sessions li')).toHaveText([
      /Wed 14 Oct\s+Held/,
      /Fri 9 Oct\s+Charged\s+No-show: you didn’t come/,
      /Tue 6 Oct\s+Held/,
    ]);
    await expectNoHorizontalOverflow(page);
    await expectNoAxeViolations(page);
    await page.screenshot({ path: `test-results/b10c-pack-${width}.png`, fullPage: true });
  });
}

test('a pack follows dark mode, and a long reason and 200% text stay inside the page', async ({
  page,
}) => {
  const reason =
    'Cancelled less than twenty-four hours before the session, so it is charged. '.repeat(4);
  await openPlan(
    page,
    [
      {
        ...PERSONAL_TRAINING,
        sessions: {
          ...PERSONAL_TRAINING.sessions,
          sessions: [{ day: '2026-10-09', outcome: 'Charged', reason }],
        },
      },
    ],
    { user: { preferredThemeMode: 'dark' } },
  );

  await expect(page.locator('html')).toHaveAttribute('data-mode', 'dark');
  await expectNoHorizontalOverflow(page);
  await expectNoAxeViolations(page);
  await page.screenshot({ path: 'test-results/b10c-pack-dark-390.png', fullPage: true });

  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%';
  });
  await expectNoHorizontalOverflow(page);
});

test('a long list of sessions opens on request', async ({ page }) => {
  const sessions = Array.from({ length: 8 }, (_, index) => ({
    day: `2026-10-${String(14 - index).padStart(2, '0')}`,
    outcome: 'Held',
    reason: null,
  }));
  await openPlan(page, [
    {
      ...PERSONAL_TRAINING,
      sessions: { ...PERSONAL_TRAINING.sessions, left: 2, used: 8, sessions },
    },
  ]);

  await expect(page.locator('.sessions li')).toHaveCount(5);
  await page.getByRole('button', { name: 'Show all 8' }).click();
  await expect(page.locator('.sessions li')).toHaveCount(8);
  await page.getByRole('button', { name: 'Show less' }).click();
  await expect(page.locator('.sessions li')).toHaveCount(5);
});

test('My plan follows dark mode and reads every state of a plan', async ({ page }) => {
  await openPlan(
    page,
    [
      { ...ONLINE_COACHING, status: 'Paused' },
      {
        ...ONLINE_COACHING,
        id: '00000000-0000-4000-8000-0000000000c2',
        name: 'Next block',
        startDate: '2026-12-28',
        lastDay: '2027-02-21',
        status: 'PendingPayment',
        description: null,
      },
    ],
    { user: { preferredThemeMode: 'dark' } },
  );

  await expect(page.locator('html')).toHaveAttribute('data-mode', 'dark');
  await expect(page.getByText('It still ends on Sun 27 Dec.')).toBeVisible();
  await expect(page.getByText('Waiting for payment')).toBeVisible();
  await expect(page.getByText('It starts once your coach has your payment.')).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await expectNoAxeViolations(page);
  await page.screenshot({ path: 'test-results/b10a-plan-dark-390.png', fullPage: true });
});

test('My plan keeps a long name and 200% text inside the page', async ({ page }) => {
  await openPlan(page, [
    {
      ...ONLINE_COACHING,
      name: 'Transformation with a very long name that a coach typed in without a thought',
      optionLabel: 'Student rate for the whole of the first year',
      lastDay: '2027-03-01',
    },
  ]);
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%';
  });

  await expectNoHorizontalOverflow(page);
  await expect(page.getByText('5 Oct 2026 – 1 Mar 2027')).toBeVisible();
  await page.screenshot({ path: 'test-results/b10a-plan-200-390.png', fullPage: true });
});

for (const [width, height] of [
  [390, 844],
  [1440, 900],
] as const) {
  test(`My plan at ${width}px offers Ask to renew in a plan's last days`, async ({ page }) => {
    await openPlan(page, [{ ...ONLINE_COACHING, lastDay: '2026-10-17' }], {
      width,
      height,
      renewal: ASK,
    });

    const plan = page.getByRole('region', { name: 'Online Coaching' });
    await expect(
      plan.getByText('Your coaching plan with Hicham ends on Sat 17 Oct.'),
    ).toBeVisible();
    await expect(plan.getByRole('link', { name: 'Go to Today' })).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
    await expectNoAxeViolations(page);
    await page.screenshot({ path: `test-results/b14-plan-ending-${width}.png`, fullPage: true });

    await plan.getByRole('button', { name: 'Ask to renew' }).click();
    const sent = plan.getByRole('status');
    await expect(sent).toHaveText(
      'Renewal request sent on Thu 15 Oct. You can ask again from Thu 22 Oct.',
    );
    await expect(sent).toBeFocused();
    await expect(plan.getByRole('button', { name: 'Ask to renew' })).toHaveCount(0);
    await expectNoAxeViolations(page);
    await page.screenshot({ path: `test-results/b14-plan-asked-${width}.png`, fullPage: true });
  });

  test(`My plan at ${width}px asks about a plan that ran out, in place of Go to Today`, async ({
    page,
  }) => {
    await openPlan(page, [{ ...ONLINE_COACHING, status: 'Expired', lastDay: '2026-10-10' }], {
      width,
      height,
      renewal: { ...ASK, planEnded: true, endedOn: '2026-10-10', endsOn: null },
    });

    await expect(page.getByText('Ended', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Ask to renew' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Go to Today' })).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
    await expectNoAxeViolations(page);
    await page.screenshot({ path: `test-results/b14-plan-ended-${width}.png`, fullPage: true });
  });
}

test('Ask to renew reads in dark mode, and 200% text stays inside the page', async ({ page }) => {
  await openPlan(page, [{ ...ONLINE_COACHING, lastDay: '2026-10-17' }], {
    renewal: ASK,
    user: { preferredThemeMode: 'dark' },
  });

  await expectNoHorizontalOverflow(page);
  await expectNoAxeViolations(page);
  await page.screenshot({ path: 'test-results/b14-plan-ending-dark-390.png', fullPage: true });

  await page.getByRole('button', { name: 'Ask to renew' }).click();
  await expect(page.getByRole('status')).toContainText('Renewal request sent');
  await expectNoAxeViolations(page);
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%';
  });
  await expectNoHorizontalOverflow(page);
});

test('the coaching plan that ended leads, with the ask, beside a pack that runs on', async ({
  page,
}) => {
  await openPlan(
    page,
    [{ ...ONLINE_COACHING, status: 'Expired', lastDay: '2026-10-10' }, PERSONAL_TRAINING],
    { renewal: { ...ASK, planEnded: true, endedOn: '2026-10-10', endsOn: null } },
  );

  const plans = page.locator('section.plan');
  await expect(plans.first().getByRole('button', { name: 'Ask to renew' })).toBeVisible();
  await expect(plans.nth(1).getByRole('button', { name: 'Ask to renew' })).toHaveCount(0);
  await expect(plans.nth(1).getByText('7 of 10 sessions with Hicham left')).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await expectNoAxeViolations(page);
  await page.screenshot({ path: 'test-results/b14-plan-beside-pack-390.png', fullPage: true });
});

test('a pack that stands as the plan keeps its own line and gains the button', async ({ page }) => {
  await openPlan(page, [{ ...PERSONAL_TRAINING, lastDay: '2026-10-17' }], {
    renewal: { ...ASK, planId: PERSONAL_TRAINING.id },
  });

  const pack = page.getByRole('region', { name: 'Personal training' });
  await expect(pack.getByText('7 of 10 sessions with Hicham left, until 17 October')).toBeVisible();
  await expect(pack.getByText('Your coaching plan')).toHaveCount(0);
  await expect(pack.getByRole('button', { name: 'Ask to renew' })).toBeVisible();
  await expectNoAxeViolations(page);
});

test('a plan that ran out says what to do next, and Today is one tap away', async ({ page }) => {
  await openPlan(page, [{ ...ONLINE_COACHING, status: 'Expired', lastDay: '2026-10-10' }]);

  await expect(page.getByText('Ended', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Go to Today' })).toHaveAttribute('href', '/');
  await expectNoAxeViolations(page);
  await page.screenshot({ path: 'test-results/b10a-plan-ended-390.png', fullPage: true });
});

test('a client with no plan yet is told it will appear here', async ({ page }) => {
  await openPlan(page, []);

  await expect(page.getByRole('heading', { name: 'No plan yet' })).toBeVisible();
  await expect(page.getByText('Your coach will put your plan here.')).toBeVisible();
  await expectNoAxeViolations(page);
});

test('a coach you cannot message is shown, but not as a link', async ({ page }) => {
  await openMe(page, { messaging: 'NoEntitlement' });

  await expect(page.locator('.coach')).toContainText('Lea Haddad');
  await expect(page.getByRole('link', { name: /Your coach/ })).toHaveCount(0);
  await expectNoAxeViolations(page);
});

test('a client with two coaches can switch between them from Me', async ({ page }) => {
  await openMe(page, { memberships: [ATLAS, BARBELL] });

  const open = page.locator('[aria-current="true"]');
  await expect(open).toContainText('Atlas Performance');
  await expect(open).toContainText('open now');
  await expect(page.getByRole('button', { name: /Switch to Beirut Barbell/ })).toBeVisible();
  await page.screenshot({ path: 'test-results/r25c-me-coaches-390.png', fullPage: true });
  await expectNoAxeViolations(page);
});

test('the weight unit saves on the account as soon as it is chosen, and sticks', async ({
  page,
}) => {
  let user: User = { ...MAYA };
  const saved: unknown[] = [];
  await openMe(page, {
    extra: {
      'GET /api/auth/me': (route) => json(route, 200, user),
      'PUT /api/auth/me/weight-unit': (route) => {
        const body = route.request().postDataJSON() as { unit: string };
        saved.push(body);
        user = { ...user, preferredWeightUnit: body.unit };
        return json(route, 200, user);
      },
    },
  });

  await page.getByRole('radio', { name: 'lb' }).check();
  await expect(page.getByRole('radio', { name: 'lb' })).toBeChecked();
  await expect.poll(() => saved).toEqual([{ unit: 'Pound' }]);
  await page.reload();
  await expect(page.getByRole('radio', { name: 'lb' })).toBeChecked();
  await expect(page.getByRole('alert')).toHaveText('');
});

// Found live, not in a mock: sign-in fetches the security token for nobody, the server binds a
// token to the signed-in person, and the first save after signing in was refused (400) without a
// fresh one. A mock accepts anything, so this pins the request order instead.
test('a save fetches a fresh security token first', async ({ page }) => {
  const order: string[] = [];
  let user: User = { ...MAYA };
  await openMe(page, {
    extra: {
      'GET /api/auth/csrf': (route) => {
        order.push('token');
        return json(route, 200, { token: 'e2e-csrf' });
      },
      'PUT /api/auth/me/weight-unit': (route) => {
        order.push('save');
        user = { ...user, preferredWeightUnit: 'Pound' };
        return json(route, 200, user);
      },
    },
  });
  order.length = 0;

  await page.getByRole('radio', { name: 'lb' }).check();

  await expect.poll(() => order).toEqual(['token', 'save']);
});

test.describe('when the account refuses a save', () => {
  test.use({
    allowedConsoleErrors: {
      patterns: [/status of 500 .*\/api\/auth\/me\/weight-unit/],
    },
  });

  test('the control goes back where the account has it, and says so', async ({ page }) => {
    await openMe(page, {
      extra: { 'PUT /api/auth/me/weight-unit': (route) => json(route, 500, { title: 'Nope' }) },
    });

    await page.getByRole('radio', { name: 'lb' }).check();
    await expect(page.getByRole('alert')).toHaveText('Couldn’t save your choice. Try again.');
    await expect(page.getByRole('radio', { name: 'kg' })).toBeChecked();
    await expect(page.getByRole('radio', { name: 'lb' })).not.toBeChecked();
    await expectNoAxeViolations(page);
  });
});

test.describe('a client whose coach cannot be read', () => {
  test.use({
    allowedConsoleErrors: {
      patterns: [/status of 403 .*\/api\/client-profile\/me\/coach/],
    },
  });

  test('is shown no coach line, and no error', async ({ page }) => {
    await openMe(page, {
      extra: {
        'GET /api/client-profile/me/coach': (route) => json(route, 403, { title: 'Forbidden' }),
      },
    });

    await expect(page.locator('.coach')).toHaveCount(0);
    await expect(page.getByRole('alert')).toHaveText('');
    await expectNoAxeViolations(page);
  });
});

test('light or dark is chosen on Me and applies at once', async ({ page }) => {
  let user: User = { ...MAYA };
  await openMe(page, {
    extra: {
      'GET /api/auth/me': (route) => json(route, 200, user),
      'PUT /api/auth/me/theme': (route) => {
        const { mode } = route.request().postDataJSON() as { mode: string };
        user = { ...user, preferredThemeMode: mode };
        return json(route, 200, user);
      },
    },
  });

  await page.getByRole('radio', { name: 'Dark' }).check();
  await expect(page.locator('html')).toHaveAttribute('data-mode', 'dark');
  await expect(page.getByRole('radio', { name: 'Dark' })).toBeChecked();
});

test('two choices in a row are saved one after the other, never at the same time', async ({
  page,
}) => {
  let user: User = { ...MAYA };
  const order: string[] = [];
  let themeSettled = false;
  await openMe(page, {
    extra: {
      'PUT /api/auth/me/theme': async (route) => {
        order.push('theme sent');
        await new Promise((resolve) => setTimeout(resolve, 400));
        const { mode } = route.request().postDataJSON() as { mode: string };
        user = { ...user, preferredThemeMode: mode };
        themeSettled = true;
        order.push('theme answered');
        return json(route, 200, user);
      },
      'PUT /api/auth/me/weight-unit': (route) => {
        order.push(themeSettled ? 'unit sent after theme' : 'unit sent while theme pending');
        const { unit } = route.request().postDataJSON() as { unit: string };
        user = { ...user, preferredWeightUnit: unit };
        return json(route, 200, user);
      },
    },
  });

  await page.getByRole('radio', { name: 'Dark' }).check();
  await page.getByRole('radio', { name: 'lb' }).check();
  await expect.poll(() => order).toEqual(['theme sent', 'theme answered', 'unit sent after theme']);
  await expect(page.getByRole('radio', { name: 'Dark' })).toBeChecked();
  await expect(page.getByRole('radio', { name: 'lb' })).toBeChecked();
});

test('Me reflows at 200% text without sideways scrolling', async ({ page }) => {
  await openMe(page, { memberships: [ATLAS, BARBELL] });
  await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });

  await expectNoHorizontalOverflow(page);
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
  // Closing the account is the last control (notes plan N9e). The tab bar sticks to the bottom, so it
  // must end above it.
  const last = page.getByRole('button', { name: 'Close your TB Gym account' });
  await last.scrollIntoViewIfNeeded();
  await expect(last).toBeVisible();
  const box = await last.boundingBox();
  const tabs = await page.locator('app-client-tabs').boundingBox();
  expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual((tabs?.y ?? 0) + 1);
});

// ---------- closing the account (notes plan N9e) ----------

/** Me with the close route answered: a wrong password first when asked, then closed; the session ends with it. */
async function openMeToClose(
  page: Page,
  options: { width?: number; height?: number; wrongPasswordFirst?: boolean } = {},
) {
  const sent: string[] = [];
  let closed = false;
  await openMe(page, {
    width: options.width,
    height: options.height,
    extra: {
      'GET /api/auth/me': (route) => json(route, 200, closed ? null : MAYA),
      'POST /api/auth/account/close': (route) => {
        const { password } = route.request().postDataJSON() as { password: string };
        sent.push(password);
        if (options.wrongPasswordFirst && sent.length === 1) {
          return json(route, 400, {
            title: 'One or more validation errors occurred.',
            status: 400,
            errors: { password: ['That password isn’t right.'] },
          });
        }
        closed = true;
        return route.fulfill({ status: 204 });
      },
    },
  });
  return sent;
}

for (const [width, height] of [
  [390, 844],
  [1440, 900],
] as const) {
  test(`Close account at ${width}px says what goes and what stays, then asks for the password`, async ({
    page,
  }) => {
    await openMeToClose(page, { width, height });
    const open = page.getByRole('button', { name: 'Close your TB Gym account' });
    await open.scrollIntoViewIfNeeded();
    await expect(page.getByRole('heading', { name: 'Close your account', level: 2 })).toBeVisible();
    await page.screenshot({ path: `test-results/n9e-me-close-${width}.png`, fullPage: true });

    await open.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Close your TB Gym account?' })).toBeVisible();
    await expect(dialog.getByText('Kept, without your name')).toBeVisible();
    await expect(
      dialog.getByText('health details included, and your progress photos'),
    ).toBeVisible();
    await expect(dialog.getByLabel('Your password')).toHaveAttribute(
      'autocomplete',
      'current-password',
    );
    await expectNoAxeViolations(page);
    await page.screenshot({ path: `test-results/n9e-me-close-dialog-${width}.png` });

    await dialog.getByRole('button', { name: 'Keep my account' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(open).toBeFocused();
  });
}

test.describe('when the first password is wrong', () => {
  test.use({ allowedConsoleErrors: { patterns: [/status of 400 .*\/api\/auth\/account\/close/] } });

  test('a wrong password is said under its field, and the right one closes the account and leaves for sign-in', async ({
    page,
  }) => {
    const sent = await openMeToClose(page, { wrongPasswordFirst: true });
    await page.getByRole('button', { name: 'Close your TB Gym account' }).click();
    const dialog = page.getByRole('dialog');

    await dialog.getByRole('button', { name: 'Close my account' }).click();
    await expect(dialog.getByText('Type your password to close your account.')).toBeVisible();
    expect(sent).toEqual([]);

    await dialog.getByLabel('Your password').fill('not-it');
    await dialog.getByRole('button', { name: 'Close my account' }).click();
    await expect(
      dialog.getByText('That password isn’t right. Type the one you sign in with.'),
    ).toBeVisible();
    await expectNoAxeViolations(page);

    await dialog.getByLabel('Your password').fill('Correct horse 12!');
    await dialog.getByRole('button', { name: 'Close my account' }).click();
    await expect(page).toHaveURL(/\/auth\/sign-in\?reason=account-closed/);
    await expect(
      page.getByText('Your TB Gym account is closed and your details are erased.'),
    ).toBeVisible();
    await expect(page.getByText('You were signed out.')).toHaveCount(0);
    expect(sent).toEqual(['not-it', 'Correct horse 12!']);
    await expectNoAxeViolations(page);
  });
});

test('someone with no coaching space left closes their account from Password and security', async ({
  page,
}) => {
  let closed = false;
  await page.setViewportSize({ width: 390, height: 844 });
  await mockSession(page, {
    memberships: [],
    user: MAYA,
    extra: {
      'GET /api/auth/me': (route) => json(route, 200, closed ? null : MAYA),
      'POST /api/auth/account/close': (route) => {
        closed = true;
        return route.fulfill({ status: 204 });
      },
    },
  });
  await page.goto('/account/security');
  await expect(
    page.getByRole('heading', { name: 'Password and security', level: 1 }),
  ).toBeVisible();
  const panel = page.getByRole('region', { name: 'Close your account' });
  await expect(panel.getByText('Erase your details from TB Gym for good.')).toBeVisible();
  await waitForFonts(page);
  await expectNoAxeViolations(page);
  await page.screenshot({ path: 'test-results/n9e-security-close-390.png', fullPage: true });

  await panel.getByRole('button', { name: 'Close your TB Gym account' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Your password').fill('Correct horse 12!');
  await dialog.getByRole('button', { name: 'Close my account' }).click();
  await expect(page).toHaveURL(/\/auth\/sign-in\?reason=account-closed/);
  await expect(
    page.getByText('Your TB Gym account is closed and your details are erased.'),
  ).toBeVisible();
});

test('someone who also coaches a space is not offered closing on Me', async ({ page }) => {
  await openMe(page, { memberships: [ATLAS, { ...BARBELL, role: 'Coach' }] });

  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Close your TB Gym account' })).toHaveCount(0);
});

test('the closing dialog reflows at 200% text without sideways scrolling', async ({ page }) => {
  await openMeToClose(page);
  await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
  await page.getByRole('button', { name: 'Close your TB Gym account' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Close your TB Gym account?' })).toBeVisible();

  await expectNoHorizontalOverflow(page);
  const submit = dialog.getByRole('button', { name: 'Close my account' });
  await submit.scrollIntoViewIfNeeded();
  await expect(submit).toBeVisible();
  await page.screenshot({ path: 'test-results/n9e-me-close-dialog-200.png' });
});

test('Sign out leaves for the sign-in page', async ({ page }) => {
  await openMe(page, {
    extra: { 'POST /api/auth/logout': (route) => route.fulfill({ status: 204 }) },
  });

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/auth\/sign-in/);
});

// ---------- the installable app ----------

test('where the browser can install the app, Me offers it and Install asks the browser', async ({
  page,
}) => {
  await openMe(page);
  const card = page.getByRole('region', { name: INSTALL });
  await expect(card).toHaveCount(0);

  await offerInstall(page);
  await expect(card).toBeVisible();
  await expect(card.getByText('Open it like any app')).toBeVisible();
  await expectNoAxeViolations(page);
  await page.screenshot({ path: 'test-results/r25c-me-install-390.png', fullPage: true });

  await card.getByRole('button', { name: 'Install app' }).click();
  await expect.poll(() => prompted(page)).toBe(1);
  await expect(card).toHaveCount(0);
});

test('a refused install ends the offer for this visit, since Chrome lets an event be used once', async ({
  page,
}) => {
  await openMe(page);
  await offerInstall(page, 'dismissed');
  const card = page.getByRole('region', { name: INSTALL });

  await card.getByRole('button', { name: 'Install app' }).click();
  await expect.poll(() => prompted(page)).toBe(1);
  await expect(card).toHaveCount(0);
});

test.describe('on an iPhone', () => {
  test.use({ userAgent: IPHONE });

  test('Me shows the Share-menu steps and no Install button', async ({ page }) => {
    await openMe(page);

    const card = page.getByRole('region', { name: INSTALL });
    await expect(card.getByRole('listitem')).toHaveText([
      'Tap Share',
      'Choose Add to Home Screen',
      'Tap Add',
    ]);
    await expect(card.getByRole('button')).toHaveCount(0);
    await expectNoAxeViolations(page);
    await page.screenshot({ path: 'test-results/r25c-me-install-ios-390.png', fullPage: true });
  });

  test('an app already installed is not offered itself', async ({ page }) => {
    await page.addInitScript(() => Object.defineProperty(navigator, 'standalone', { value: true }));
    await openMe(page);

    await expect(page.getByRole('region', { name: INSTALL })).toHaveCount(0);
  });
});

test('the manifest names the app, starts at sign-in and carries the icons Chrome needs', async ({
  request,
}) => {
  const response = await request.get('/manifest.webmanifest');
  expect(response.headers()['content-type']).toContain('manifest+json');
  const manifest = await response.json();

  expect(manifest).toMatchObject({
    id: '/',
    name: 'TB Gym',
    short_name: 'TB Gym',
    start_url: '/auth/sign-in',
    scope: '/',
    display: 'standalone',
    background_color: '#fbfaf5',
    theme_color: '#f5f3ea',
  });
  expect(manifest.icons.map((icon: { purpose: string }) => icon.purpose)).toEqual([
    'any',
    'any',
    'maskable',
  ]);
  for (const icon of manifest.icons as { src: string; sizes: string; type: string }[]) {
    const file = await request.get(icon.src);
    expect(file.ok(), icon.src).toBe(true);
    expect(file.headers()['content-type']).toBe(icon.type);
    // The PNG header holds the real width and height, which must be what the manifest promises.
    const bytes = await file.body();
    expect(`${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`).toBe(icon.sizes);
  }
});

test('the page links its manifest and icons, and Chromium finds nothing to stop an install', async ({
  page,
  context,
}) => {
  await mockSignedOut(page);
  await page.goto('/auth/sign-in');

  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
    'href',
    'manifest.webmanifest',
  );
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute(
    'href',
    'icons/apple-touch-icon.png',
  );
  await expect(page.locator('meta[name="theme-color"]')).toHaveCount(2);
  const cdp = await context.newCDPSession(page);
  // Playwright's own browser context is incognito, the one reason a test cannot change. Nothing
  // else is listed: in particular no service worker is needed.
  await expect
    .poll(async () => {
      const { installabilityErrors } = await cdp.send('Page.getInstallabilityErrors');
      return installabilityErrors
        .map((error) => error.errorId)
        .filter((id) => id !== 'in-incognito');
    })
    .toEqual([]);
});

// ---------- the launch screen ----------

test.describe('the launch screen', () => {
  // Serving the page rewritten stops Vite's development client reaching its websocket; that, and
  // nothing else, is allowed to be logged.
  test.use({
    allowedConsoleErrors: { patterns: [/@vite\/client/] },
  });

  test('an installed app draws it from index.html until the script arrives', async ({ page }) => {
    await mockSignedOut(page);
    // The media condition cannot be emulated, so the page is served with it removed: this proves the
    // rule, the picture and the colours. That the screen is shown only when installed is the
    // browser's own `display-mode`. The installed app starts at sign-in: a visitor gets it rendered at
    // build time (audit UIQ-13), with nothing to wait for, and someone signed in gets the plain shell,
    // as every deep link does. The development server renders sign-in for everyone, so this opens
    // another address the shell serves.
    await page.route('**/main.js', () => new Promise<void>(() => undefined));
    await page.route('**/auth/register', async (route) => {
      if (route.request().resourceType() !== 'document') return route.fallback();
      const response = await route.fetch();
      const html = (await response.text()).replaceAll('(display-mode: standalone)', 'all');
      await route.fulfill({ response, body: html });
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/auth/register', { waitUntil: 'commit' });
    await page.waitForSelector('app-root', { state: 'attached' });

    await expect
      .poll(() =>
        page.evaluate(() => {
          const before = getComputedStyle(document.querySelector('app-root')!, '::before');
          return [
            before.position,
            before.backgroundColor,
            before.backgroundImage.includes('icons/icon-192.png'),
          ];
        }),
      )
      .toEqual(['fixed', 'rgb(251, 250, 245)', true]);
  });
});

test('the app draws the same screen while it waits for the first answer, then Today, never the old bar', async ({
  page,
}) => {
  let answer!: () => void;
  const waiting = new Promise<void>((resolve) => (answer = resolve));
  await page.setViewportSize({ width: 390, height: 844 });
  await mockClient(page, {
    extra: {
      'GET /api/auth/me': async (route) => {
        await waiting;
        return json(route, 200, MAYA);
      },
    },
  });
  await page.goto('/me');

  const launch = page.getByRole('status').filter({ hasText: 'Loading TB Gym…' });
  await expect(launch).toBeVisible();
  const style = await launch.evaluate((element) => {
    const css = getComputedStyle(element);
    return [css.position, css.backgroundImage.includes('icons/icon-192.png')];
  });
  expect(style).toEqual(['fixed', true]);
  await expect(page.getByText('Checking session')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/r25c-launch-390.png' });

  answer();
  await expect(page.getByRole('heading', { name: 'Me', level: 1 })).toBeVisible();
  await expect(launch).toHaveCount(0);
});

// ---------- the coach's Founding coach badge (notes plan N3b) ----------

const FOUNDING = {
  'GET /api/client-profile/me/coach': (route: Route) =>
    json(route, 200, { name: 'Lea Haddad', foundingCoach: true }),
};

for (const [width, height, mode] of [
  [390, 844, 'system'],
  [1440, 900, 'system'],
  [390, 844, 'dark'],
  [1440, 900, 'dark'],
] as const) {
  test(`Me shows the coach’s Founding coach badge and its line at ${width}px, ${mode}`, async ({
    page,
  }) => {
    await openMe(page, { width, height, user: { preferredThemeMode: mode }, extra: FOUNDING });

    const coach = page.getByRole('link', { name: /Your coach.*Lea Haddad.*Founding coach/ });
    await expect(coach).toHaveAttribute('href', '/messages');
    await expect(coach.locator('app-status-pill')).toHaveText('Founding coach');
    await expect(coach.locator('.coach-founding')).toHaveText(
      'One of the first coaches on TB Gym. Not a check of qualifications',
    );
    await expectNoHorizontalOverflow(page);
    await expectNoAxeViolations(page);
    await page.screenshot({
      path: `test-results/n3b-me-founding-${width}-${mode}.png`,
      fullPage: true,
    });
  });
}

test('Me shows the badge on the plain card too, inside the card at 200% text', async ({ page }) => {
  await openMe(page, { messaging: 'NoEntitlement', extra: FOUNDING });
  const card = page.locator('.coach');
  await expect(card.locator('app-status-pill')).toHaveText('Founding coach');
  await expect(page.locator('a.coach')).toHaveCount(0);

  await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
  await expect(card.locator('.coach-founding')).toBeVisible();
  await expectNoHorizontalOverflow(page);
  // The hero card hides what spills out of it, so the page's own check cannot see a clipped part.
  const outer = (await card.boundingBox())!;
  for (const part of [card.locator('app-status-pill'), card.locator('.coach-founding')]) {
    const inner = (await part.boundingBox())!;
    expect(inner.x).toBeGreaterThanOrEqual(outer.x - 0.5);
    expect(inner.x + inner.width).toBeLessThanOrEqual(outer.x + outer.width + 0.5);
    expect(inner.y + inner.height).toBeLessThanOrEqual(outer.y + outer.height + 0.5);
  }
  await expectNoAxeViolations(page);
  await page.screenshot({ path: 'test-results/n3b-me-founding-plain-200.png', fullPage: true });
});

// ---------- what TB Gym shows about the coach (notes plan N4b) ----------

/** The coach's certificate lines the server shows this client, in the order TB Gym recorded them. */
const COACH_LINES = [
  {
    text: 'NASM CPT, 2019, shown to TB Gym on 1 Oct 2026',
    what: 'NASM CPT, 2019',
    shownOn: '2026-10-01',
  },
  {
    text: 'Owns Iron House gym in Hamra, shown to TB Gym on 8 Oct 2026',
    what: 'Owns Iron House gym in Hamra',
    shownOn: '2026-10-08',
  },
];

/** A line long enough to wrap on a phone, more so at 200% text. */
const LONG_LINE = {
  text: 'Owns Iron House gym in Hamra since 2015, with a strength floor, two lifting platforms and a turf lane, shown to TB Gym on 8 Oct 2026',
  what: 'Owns Iron House gym in Hamra since 2015, with a strength floor, two lifting platforms and a turf lane',
  shownOn: '2026-10-08',
};

/** The coach as the server answers with lines; the default mock above carries none. */
const coachWith = (lines: object[], foundingCoach = false) => ({
  'GET /api/client-profile/me/coach': (route: Route) =>
    json(route, 200, { name: 'Lea Haddad', foundingCoach, lines }),
});

/** The coach's card once read, not the place kept for it while it is read. */
const coachCard = (page: Page) => page.locator('.hero .coach:not(.coach--waiting)');

/**
 * The words of the lines that the card cuts across two rows: a column too narrow for a word breaks it
 * anywhere (`overflow-wrap: anywhere`), which keeps it inside the card but no longer reads as words.
 */
const cutWords = (lines: Locator) =>
  lines.evaluateAll((items) =>
    items.flatMap((item) => {
      const text = item.querySelector('bdi')?.firstChild;
      if (!(text instanceof Text)) return ['(no text)'];
      return Array.from(text.data.matchAll(/\S+/g)).flatMap((word) => {
        const range = document.createRange();
        range.setStart(text, word.index);
        range.setEnd(text, word.index + word[0].length);
        const rows = new Set(Array.from(range.getClientRects(), (rect) => Math.round(rect.top)));
        return rows.size > 1 ? [word[0]] : [];
      });
    }),
  );

/**
 * Axe as a person meets Me: the lines push the rows below down, and a row the client's tab bar covers
 * at the first scroll is judged where a person reaches it (CLIENT-7). Anything else still fails.
 */
async function expectNoAxeViolationsWhereReached(page: Page) {
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
    .analyze();
  expect(
    (await personFacing(page, result.violations)).map(
      (violation) =>
        `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).join(', ')}`,
    ),
  ).toEqual([]);
}

test.describe('what TB Gym shows about the coach (notes plan N4b)', () => {
  for (const [width, height, mode] of [
    [390, 844, 'system'],
    [390, 844, 'dark'],
    [1440, 900, 'system'],
    [1440, 900, 'dark'],
  ] as const) {
    test(`Me shows the coach’s certificate lines under their name, inside the link, at ${width}px, ${mode}`, async ({
      page,
    }) => {
      await openMe(page, {
        width,
        height,
        user: { preferredThemeMode: mode },
        extra: coachWith(COACH_LINES),
      });

      // The lines join the card's name, and the card is still the way to Messages.
      const coach = page.getByRole('link', {
        name: /Your coach.*Lea Haddad.*NASM CPT, 2019, shown to TB Gym on 1 Oct 2026.*Owns Iron House gym in Hamra, shown to TB Gym on 8 Oct 2026.*Message/,
      });
      await expect(coach).toHaveAttribute('href', '/messages');
      const lines = coach.locator('[data-coach-line]');
      await expect(lines).toHaveText(COACH_LINES.map((line) => line.text));
      // Each is its sentence in a <bdi> and nothing else: no pill, no icon, no count.
      await expect(coach.locator('[data-coach-line] > bdi')).toHaveText(
        COACH_LINES.map((line) => line.text),
      );
      expect(await lines.evaluateAll((items) => items.map((item) => item.children.length))).toEqual(
        [1, 1],
      );
      await expect(coach.locator('app-status-pill')).toHaveCount(0);
      await expect(coach.locator('.coach-text app-icon, .coach-text svg')).toHaveCount(0);

      // Under the name, each on its own row, in quieter text than the name.
      const name = (await coach.locator('.coach-text strong').boundingBox())!;
      const first = (await lines.nth(0).boundingBox())!;
      const second = (await lines.nth(1).boundingBox())!;
      expect(first.y).toBeGreaterThanOrEqual(name.y + name.height - 0.5);
      expect(second.y).toBeGreaterThanOrEqual(first.y + first.height - 0.5);
      expect(Math.abs(first.x - name.x)).toBeLessThan(1);
      expect(Math.abs(second.x - name.x)).toBeLessThan(1);
      const [nameSize, lineSize] = await coach.evaluate((card) =>
        [card.querySelector('.coach-text strong')!, card.querySelector('[data-coach-line]')!].map(
          (element) => parseFloat(getComputedStyle(element).fontSize),
        ),
      );
      expect(lineSize).toBeLessThan(nameSize);

      if (mode === 'dark') await expect(page.locator('html')).toHaveAttribute('data-mode', 'dark');
      await expectNoHorizontalOverflow(page);
      await expectNoAxeViolationsWhereReached(page);
      await page.screenshot({
        path: `test-results/n4b-me-lines-${width}-${mode}.png`,
        fullPage: true,
      });
    });
  }

  test('the lines come after the Founding coach badge’s line, at 390px', async ({ page }) => {
    await openMe(page, { extra: coachWith(COACH_LINES, true) });

    const coach = page.getByRole('link', {
      name: /Your coach.*Lea Haddad.*Founding coach.*One of the first coaches on TB Gym.*NASM CPT, 2019.*Owns Iron House gym in Hamra/,
    });
    await expect(coach).toHaveAttribute('href', '/messages');
    // The one pill is the badge's own.
    await expect(coach.locator('app-status-pill')).toHaveText('Founding coach');
    await expect(coach.locator('[data-coach-line]')).toHaveText(
      COACH_LINES.map((line) => line.text),
    );
    const founding = (await coach.locator('.coach-founding').boundingBox())!;
    const first = (await coach.locator('[data-coach-line]').first().boundingBox())!;
    expect(first.y).toBeGreaterThanOrEqual(founding.y + founding.height - 0.5);
    await expectNoHorizontalOverflow(page);
    await expectNoAxeViolationsWhereReached(page);
    await page.screenshot({ path: 'test-results/n4b-me-lines-founding-390.png', fullPage: true });
  });

  for (const messaging of ['Granted', 'NoEntitlement'] as const) {
    const card = messaging === 'Granted' ? 'link' : 'plain card';

    test(`the lines stay inside the ${card} at 200% text`, async ({ page }) => {
      await openMe(page, { messaging, extra: coachWith([COACH_LINES[0], LONG_LINE]) });
      const coach = coachCard(page);
      const lines = coach.locator('[data-coach-line]');
      await expect(lines).toHaveText([COACH_LINES[0].text, LONG_LINE.text]);
      await expect(page.locator('a.coach')).toHaveCount(messaging === 'Granted' ? 1 : 0);

      await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
      await expect(lines.last()).toBeVisible();
      await expectNoHorizontalOverflow(page);
      // The hero card hides what spills out of it, so the page's own check cannot see a clipped line.
      const outer = (await coach.boundingBox())!;
      for (const line of await lines.all()) {
        const inner = (await line.boundingBox())!;
        expect(inner.x).toBeGreaterThanOrEqual(outer.x - 0.5);
        expect(inner.x + inner.width).toBeLessThanOrEqual(outer.x + outer.width + 0.5);
        expect(inner.y + inner.height).toBeLessThanOrEqual(outer.y + outer.height + 0.5);
      }
      const hero = (await page.locator('.hero').boundingBox())!;
      expect(outer.x + outer.width).toBeLessThanOrEqual(hero.x + hero.width + 0.5);
      expect(outer.y + outer.height).toBeLessThanOrEqual(hero.y + hero.height + 0.5);
      // And they still read as words: the column beside the face (and Message, on the link) keeps
      // room for a whole word, so none is cut across two rows. Soft, so the still shows a failure.
      expect.soft(await cutWords(lines)).toEqual([]);
      await expectNoAxeViolationsWhereReached(page);
      await page.screenshot({
        path: `test-results/n4b-me-lines-200-${messaging === 'Granted' ? 'link' : 'plain'}.png`,
        fullPage: true,
      });
    });
  }

  // With an empty list the server sends today, the card is the one the pixel guards above hold, to
  // the pixel: no wrapper, no hidden comma, nothing.
  for (const [width, height, mode] of [
    [390, 844, 'system'],
    [1440, 900, 'system'],
    [390, 844, 'dark'],
  ] as const) {
    test(`a coach with no lines to show draws Me's card as before at ${width}px, ${mode}`, async ({
      page,
    }) => {
      await openMe(page, {
        width,
        height,
        user: { preferredThemeMode: mode },
        extra: coachWith([]),
      });
      await expect(page.getByRole('link', { name: /Your coach.*Lea Haddad/ })).toBeVisible();
      expect(
        await page
          .locator('a.coach .coach-text > *')
          .evaluateAll((children) =>
            children.map((child) => `${child.tagName}.${child.className}`),
          ),
      ).toEqual(['SPAN.coach-label', 'SPAN.tb-visually-hidden', 'STRONG.']);
      await expect(page.locator('.hero')).toHaveScreenshot(`me-coach-card-${width}-${mode}.png`);
    });
  }
});

// ---------- a self-directed trainee of TB Gym's own space (notes plan N9a2) ----------

/** TB Gym's own coaching space, whose trainees sign up with no coach. */
const HOUSE = {
  ...ATLAS,
  tenantId: '00000000-0000-4000-8000-0000000000f1',
  tenantName: 'TB Gym coaching space',
  tenantSlug: 'tb-gym-coaching-space',
};

/** Training alone, as the house gives it, and the trainee's own profile says they coach themselves. */
const TRAINEE: Record<string, Handler> = {
  'GET /api/client-access/me': (route) =>
    json(
      route,
      200,
      FEATURES.map((feature) => ({
        feature,
        isAllowed: feature === 'Training',
        reason: feature === 'Training' ? 'Granted' : 'NoEntitlement',
      })),
    ),
  'GET /api/client-profile/me': (route) =>
    json(route, 200, finishedProfile({ selfDirected: true })),
};

test.describe('a self-directed trainee of TB Gym’s own space (notes plan N9a2)', () => {
  for (const [width, height, mode] of [
    [390, 844, 'system'],
    [1440, 900, 'system'],
    [390, 844, 'dark'],
  ] as const) {
    test(`Me at ${width}px, ${mode}, names TB Gym’s space where a coach would be, as no link, and never asks for a coach`, async ({
      page,
    }) => {
      const coachReads: string[] = [];
      page.on('request', (request) => {
        if (new URL(request.url()).pathname === '/api/client-profile/me/coach') {
          coachReads.push(request.url());
        }
      });
      await openMe(page, {
        width,
        height,
        memberships: [HOUSE],
        user: { preferredThemeMode: mode },
        extra: TRAINEE,
      });

      const card = page.locator('.hero .coach[data-self-directed]');
      await expect(card.locator('.coach-text')).toHaveText('Self-directed · TB Gym coaching space');
      await expect(card.locator('.coach-label')).toHaveText('Self-directed');
      await expect(card.locator('strong')).toHaveText('TB Gym coaching space');
      await expect(card.locator('app-avatar')).toHaveText('TB');
      // Nobody's staff stands here: no Message, no badge and no certificate line.
      await expect(page.locator('a.coach')).toHaveCount(0);
      await expect(card.locator('.coach-action, app-status-pill, [data-coach-line]')).toHaveCount(
        0,
      );
      await expect(page.locator('a[href="/messages"]')).toHaveCount(0);
      expect(coachReads).toEqual([]);
      if (mode === 'dark') await expect(page.locator('html')).toHaveAttribute('data-mode', 'dark');
      await expectNoHorizontalOverflow(page);
      await expectNoAxeViolationsWhereReached(page);
      await page.screenshot({
        path: test.info().outputPath(`n9a2-me-trainee-${width}-${mode}.png`),
        fullPage: true,
      });
    });
  }

  test('Me keeps the trainee’s card inside the page at 200% text', async ({ page }) => {
    await openMe(page, { memberships: [HOUSE], extra: TRAINEE });
    await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });

    const card = page.locator('.hero .coach[data-self-directed]');
    await expect(card.locator('strong')).toBeVisible();
    await expectNoHorizontalOverflow(page);
    // The hero card hides what spills out of it, so the page's own check cannot see a clipped name.
    const outer = (await card.boundingBox())!;
    const name = (await card.locator('strong').boundingBox())!;
    expect(name.x + name.width).toBeLessThanOrEqual(outer.x + outer.width + 0.5);
    expect(name.y + name.height).toBeLessThanOrEqual(outer.y + outer.height + 0.5);
  });
});

// ---------- a self-directed trainee's My plan: Free, the plans TB Gym sells, the ask (notes plan N9c2) ----------

/** Free, as `GET /api/client-plan/me` gives it to a trainee of the house (N9b1). */
const FREE = { name: 'Free', since: '2026-10-01', status: 'Active', features: ['Training'] };

/** The house's Whish number, in the form the House page keeps it. */
const WHISH = '+961 70 123456';

/** Two options of one of the house's paid plans, as `GET /api/house-plans/me` lists them. */
const PRO_4_WEEKS = {
  offerId: '00000000-0000-4000-8000-0000000000e1',
  productId: '00000000-0000-4000-8000-0000000000e0',
  tier: 'ProPlus',
  name: 'Pro+',
  description: 'A program TB Gym writes for you, changed every block, and a check-in each week.',
  optionLabel: '4 weeks',
  priceAmount: 47.5 as number | string,
  priceCurrency: 'USD',
  durationCount: 4,
  durationUnit: 'Week',
  features: ['Training', 'CheckIns'],
};
const PRO_TWO_BLOCKS = {
  ...PRO_4_WEEKS,
  offerId: '00000000-0000-4000-8000-0000000000e2',
  optionLabel: 'Two blocks',
  priceAmount: '89.75',
  durationCount: 8,
};

const ASK_ID = '00000000-0000-4000-8000-0000000000a1';

/** An ask of one option, as the house's read carries it. */
function askOf(offer: typeof PRO_4_WEEKS, overrides: object = {}): Record<string, unknown> {
  return {
    id: ASK_ID,
    offerId: offer.offerId,
    tier: 'ProPlus',
    planName: offer.name,
    optionLabel: offer.optionLabel,
    priceAmount: offer.priceAmount,
    priceCurrency: offer.priceCurrency,
    durationCount: offer.durationCount,
    durationUnit: offer.durationUnit,
    askedOn: '2026-10-15',
    state: 'Asked',
    moneySent: null,
    outcome: null,
    ...overrides,
  };
}

/** An ask TB Gym booked, with the plan it started, and one it closed with a reason the trainee reads. */
const BOOKED = askOf(PRO_4_WEEKS, {
  id: '00000000-0000-4000-8000-0000000000a2',
  askedOn: '2026-10-01',
  state: 'Booked',
  moneySent: { whishName: 'Rima Aboud', whishNumber: '+961 71 234567', sentOn: '2026-10-01' },
  outcome: {
    kind: 'Booked',
    decidedOn: '2026-10-02',
    reason: null,
    enrollmentId: '00000000-0000-4000-8000-0000000000c9',
    planStartDate: '2026-10-02',
    planLastDay: '2026-10-29',
    decidedByName: null,
  },
});
const CLOSED = askOf(PRO_TWO_BLOCKS, {
  id: '00000000-0000-4000-8000-0000000000a3',
  askedOn: '2026-08-10',
  state: 'Closed',
  outcome: {
    kind: 'Closed',
    decidedOn: '2026-08-20',
    reason: 'No money came from that Whish account. Ask again once it is sent.',
    enrollmentId: null,
    planStartDate: null,
    planLastDay: null,
    decidedByName: null,
  },
});

/** The plan BOOKED started, as the trainee's own plans list it. */
const BOOKED_PLAN = {
  id: '00000000-0000-4000-8000-0000000000c9',
  name: 'Pro+',
  optionLabel: '4 weeks',
  description: PRO_4_WEEKS.description,
  startDate: '2026-10-02',
  lastDay: '2026-10-29',
  cancelledOn: null,
  status: 'Active',
  features: ['Training', 'CheckIns'],
};

interface HouseRead {
  asksOpen: boolean;
  whishNumber: string | null;
  plans: object[];
  asks: object[];
}

const ASKS_OFF: HouseRead = { asksOpen: false, whishNumber: null, plans: [], asks: [] };
const ASKS_ON: HouseRead = {
  asksOpen: true,
  whishNumber: WHISH,
  plans: [PRO_4_WEEKS, PRO_TWO_BLOCKS],
  asks: [],
};

/** A trainee of the house on My plan: their plans with Free, and what the house sells, read from `house`. */
async function openTraineePlan(
  page: Page,
  options: {
    width?: number;
    height?: number;
    plans?: object[];
    house?: HouseRead | (() => HouseRead);
    extra?: Record<string, Handler>;
  } = {},
) {
  await page.setViewportSize({ width: options.width ?? 390, height: options.height ?? 844 });
  const house = options.house ?? ASKS_OFF;
  await mockClient(page, {
    memberships: [HOUSE],
    extra: {
      ...TRAINEE,
      'GET /api/client-plan/me': (route) =>
        json(route, 200, {
          today: '2026-10-15',
          plans: options.plans ?? [],
          coachName: null,
          renewal: null,
          tier: 'Free',
          free: FREE,
        }),
      'GET /api/house-plans/me': (route) =>
        json(route, 200, {
          today: '2026-10-15',
          ...(typeof house === 'function' ? house() : house),
        }),
      ...(options.extra ?? {}),
    },
  });
  await page.goto('/plan');
  await expect(page.getByRole('heading', { name: 'My plan', level: 1 })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Free Since Thu 1 Oct' })).toBeVisible();
  await waitForFonts(page);
}

test('a coach’s client never reads what TB Gym sells on My plan', async ({ page }) => {
  const houseReads: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/house-plans/')) {
      houseReads.push(request.url());
    }
  });
  await openPlan(page, [ONLINE_COACHING]);

  await expect(page.getByRole('region', { name: /Online Coaching/ })).toBeVisible();
  await expect(page.getByText('What’s in your plan and the dates it runs.')).toBeVisible();
  await expect(page.locator('[data-free], [data-open-ask], [data-plans-to-add]')).toHaveCount(0);
  expect(houseReads).toEqual([]);
});

test.describe('a self-directed trainee’s My plan (notes plan N9c2)', () => {
  for (const [width, height] of [
    [390, 844],
    [1440, 900],
  ] as const) {
    test(`at ${width}px, with asks switched off, shows Free as a plan with no end, and nothing to buy`, async ({
      page,
    }) => {
      await openTraineePlan(page, { width, height });

      await expect(
        page.getByText('What you train on with TB Gym, and the dates each plan runs.'),
      ).toBeVisible();
      const free = page.getByRole('region', { name: 'Free Since Thu 1 Oct' });
      await expect(free.getByRole('heading', { name: 'Free', level: 2 })).toBeVisible();
      await expect(free.getByText('No end date', { exact: true })).toBeVisible();
      await expect(
        free.getByText('It never ends, and it keeps running beside any plan you add.'),
      ).toBeVisible();
      await expect(free.getByRole('listitem')).toHaveText(['Training']);
      await expect(free).not.toContainText(/days left|Ends /);
      await expect(page.locator('[data-plans-to-add]')).toHaveCount(0);
      await expect(page.getByText('Pay by Whish.', { exact: false })).toHaveCount(0);
      await expect(page.getByText('No plan yet')).toHaveCount(0);
      await expect(page.getByText('Your coach will put your plan here.')).toHaveCount(0);
      await expectNoHorizontalOverflow(page);
      await expectNoAxeViolations(page);
      await page.screenshot({
        path: test.info().outputPath(`n9c2-plan-asks-off-${width}.png`),
        fullPage: true,
      });
    });

    test(`at ${width}px, with asks switched on, lists one plan’s two options, each with its own Ask for`, async ({
      page,
    }) => {
      await openTraineePlan(page, { width, height, house: ASKS_ON });

      const add = page.getByRole('region', { name: 'Plans you can add' });
      await expect(
        add.getByText(
          'Pay by Whish. A plan starts once TB Gym has your money, or when your current plan ends if that is later. Free keeps running underneath.',
        ),
      ).toBeVisible();
      const offer = add.getByRole('article', { name: 'Pro+' });
      await expect(offer.getByRole('heading', { name: 'Pro+', level: 3 })).toBeVisible();
      await expect(offer.getByText(PRO_4_WEEKS.description)).toBeVisible();
      await expect(offer.locator('.includes li')).toHaveText(['Training', 'Check-ins']);
      await expect(offer.locator('.option-text')).toHaveText([
        '4 weeks USD 47.50',
        'Two blocks 8 weeks USD 89.75',
      ]);
      await expect(offer.getByRole('button')).toHaveText(['Ask for 4 weeks', 'Ask for Two blocks']);
      // Each name starts with the words on its button, so voice control finds it (WCAG 2.5.3).
      await expect(
        offer.getByRole('button', { name: 'Ask for 4 weeks, Pro+', exact: true }),
      ).toBeVisible();
      await expect(
        offer.getByRole('button', { name: 'Ask for Two blocks, Pro+', exact: true }),
      ).toBeVisible();
      // Free first, then what can be added.
      const order = await page
        .locator('[data-free], [data-plans-to-add]')
        .evaluateAll((nodes) => nodes.map((node) => node.hasAttribute('data-free')));
      expect(order).toEqual([true, false]);
      await expectNoHorizontalOverflow(page);
      await expectNoAxeViolations(page);
      await page.screenshot({
        path: test.info().outputPath(`n9c2-plan-asks-on-${width}.png`),
        fullPage: true,
      });
    });

    test(`at ${width}px, lists the asks TB Gym booked or closed after the plan it booked`, async ({
      page,
    }) => {
      await openTraineePlan(page, {
        width,
        height,
        plans: [BOOKED_PLAN],
        house: { ...ASKS_ON, asks: [BOOKED, CLOSED] },
      });

      await expect(
        page.getByRole('region', { name: 'Pro+ 4 weeks · Fri 2 Oct – Thu 29 Oct' }),
      ).toBeVisible();
      const earlier = page.getByRole('region', { name: 'Earlier asks' });
      const rows = earlier.locator('li.earlier-ask');
      await expect(rows).toHaveCount(2);
      await expect(rows.nth(0).locator('.ask-name')).toHaveText('Pro+, 4 weeks');
      await expect(rows.nth(0).locator('app-status-pill')).toHaveText('Booked');
      await expect(rows.nth(0)).toContainText('USD 47.50 · asked Thu 1 Oct');
      await expect(rows.nth(0)).toContainText('Booked Fri 2 Oct: runs Fri 2 Oct – Thu 29 Oct.');
      await expect(rows.nth(1).locator('.ask-name')).toHaveText('Pro+, Two blocks');
      await expect(rows.nth(1).locator('app-status-pill')).toHaveText('Closed');
      await expect(rows.nth(1)).toContainText('USD 89.75 · asked Mon 10 Aug');
      await expect(rows.nth(1)).toContainText('TB Gym closed this ask on Thu 20 Aug.');
      await expect(rows.nth(1).locator('.ask-reason')).toHaveText(
        'No money came from that Whish account. Ask again once it is sent.',
      );
      // The paid plan, Free, what can be added, then the asks of before.
      const order = await page
        .locator('section.plan, [data-plans-to-add], [data-earlier-asks]')
        .evaluateAll((nodes) =>
          nodes.map((node) =>
            node.hasAttribute('data-free')
              ? 'free'
              : node.hasAttribute('data-plans-to-add')
                ? 'add'
                : node.hasAttribute('data-earlier-asks')
                  ? 'earlier'
                  : 'plan',
          ),
        );
      expect(order).toEqual(['plan', 'free', 'add', 'earlier']);
      await expectNoHorizontalOverflow(page);
      await expectNoAxeViolations(page);
      await page.screenshot({
        path: test.info().outputPath(`n9c2-plan-earlier-asks-${width}.png`),
        fullPage: true,
      });
    });
  }

  test('asks for an option, then says the money was sent, and the card follows each step', async ({
    page,
  }) => {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    const asks: Record<string, unknown>[] = [];
    const sent: { ask: unknown[]; paid: unknown[] } = { ask: [], paid: [] };
    await openTraineePlan(page, {
      house: () => ({ ...ASKS_ON, asks }),
      extra: {
        'POST /api/house-plans/me/asks': (route) => {
          sent.ask.push(route.request().postDataJSON());
          const ask = askOf(PRO_TWO_BLOCKS);
          asks.unshift(ask);
          return json(route, 201, ask);
        },
        [`POST /api/house-plans/me/asks/${ASK_ID}/money-sent`]: (route) => {
          const body = route.request().postDataJSON() as { whishName: string; whishNumber: string };
          sent.paid.push(body);
          asks[0] = {
            ...asks[0],
            state: 'MoneySent',
            moneySent: {
              whishName: body.whishName,
              whishNumber: body.whishNumber,
              sentOn: '2026-10-15',
            },
          };
          return json(route, 200, asks[0]);
        },
      },
    });

    await page.getByRole('button', { name: 'Ask for Two blocks, Pro+' }).click();
    const confirm = page.getByRole('dialog', { name: 'Ask for Pro+' });
    await expect(confirm).toBeVisible();
    await expect(confirm.locator('[data-ask-choice]')).toHaveText(
      'Two blocks · 8 weeks · USD 89.75',
    );
    await expect(
      confirm.getByText(
        'You pay TB Gym by Whish, then tell us here. The plan starts once TB Gym has your money, or when your current plan ends if that is later. Free keeps running underneath.',
      ),
    ).toBeVisible();
    await expect(
      confirm.getByText('You can ask for something else once TB Gym books or closes this ask.'),
    ).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await expectNoAxeViolations(page);
    await page.screenshot({ path: test.info().outputPath('n9c2-plan-ask-sheet-390.png') });
    await confirm.getByRole('button', { name: 'Ask for it' }).click();

    await expect(confirm).toHaveCount(0);
    expect(sent.ask).toEqual([{ offerId: PRO_TWO_BLOCKS.offerId }]);
    const card = page.getByRole('region', {
      name: 'Your ask Pro+, Two blocks · USD 89.75 for 8 weeks',
    });
    await expect(card.getByText('Waiting for your payment', { exact: true })).toBeVisible();
    const news = card.getByRole('status');
    await expect(news).toHaveText('Asked. Send the money by Whish, then tell TB Gym here.');
    await expect(news).toBeFocused();
    await expect(
      card.getByText(`Send USD 89.75 by Whish to ${WHISH}, then tell TB Gym you sent it.`),
    ).toBeVisible();
    await expect(
      card.getByText('Nothing changes until TB Gym books it. Free keeps running.'),
    ).toBeVisible();
    // One ask at a time: nothing more to ask for until TB Gym books or closes this one.
    await expect(page.locator('[data-plans-to-add]')).toHaveCount(0);
    const order = await page
      .locator('section.plan')
      .evaluateAll((nodes) => nodes.map((node) => node.hasAttribute('data-open-ask')));
    expect(order).toEqual([true, false]);

    await card.getByRole('button', { name: 'Copy the Whish number' }).click();
    await expect(page.getByText('Copied the Whish number.')).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(WHISH);
    await expectNoHorizontalOverflow(page);
    await expectNoAxeViolations(page);
    await page.screenshot({
      path: test.info().outputPath('n9c2-plan-asked-390.png'),
      fullPage: true,
    });

    await card.getByRole('button', { name: 'I’ve paid' }).click();
    const paid = page.getByRole('dialog', { name: 'I’ve paid' });
    await expect(
      paid.getByText(
        'Tell TB Gym which Whish account the USD 89.75 came from, so they can find it.',
      ),
    ).toBeVisible();
    await expect(paid.getByText('You can say this once for this ask.')).toBeVisible();
    await paid.getByRole('button', { name: 'Send' }).click();
    await expect(
      paid.getByText('Enter the name on the Whish account you sent the money from.'),
    ).toBeVisible();
    await expect(paid.getByLabel('Name on your Whish account')).toBeFocused();
    expect(sent.paid).toEqual([]);
    await paid.getByLabel('Name on your Whish account').fill('  Rima   Aboud ');
    await paid.getByLabel('Your Whish number').fill(' +961   71 234567 ');
    await expectNoHorizontalOverflow(page);
    await expectNoAxeViolations(page);
    await page.screenshot({ path: test.info().outputPath('n9c2-plan-paid-sheet-390.png') });
    await paid.getByRole('button', { name: 'Send' }).click();

    await expect(paid).toHaveCount(0);
    expect(sent.paid).toEqual([{ whishName: 'Rima Aboud', whishNumber: '+961 71 234567' }]);
    await expect(card.getByText('Money sent', { exact: true })).toBeVisible();
    await expect(news).toHaveText(
      'You said you sent it on Thu 15 Oct from Rima Aboud, +961 71 234567.',
    );
    await expect(news).toBeFocused();
    await expect(
      card.getByText(
        'TB Gym books your plan once the money is there. Free keeps running underneath.',
      ),
    ).toBeVisible();
    await expect(card.getByRole('button')).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
    await expectNoAxeViolations(page);
    await page.screenshot({
      path: test.info().outputPath('n9c2-plan-money-sent-390.png'),
      fullPage: true,
    });
  });

  test('at 1440px, the open ask leads with the Whish number to send the money to', async ({
    page,
  }) => {
    await openTraineePlan(page, {
      width: 1440,
      height: 900,
      plans: [BOOKED_PLAN],
      house: { ...ASKS_ON, asks: [askOf(PRO_4_WEEKS), CLOSED] },
    });

    // The option's name is its length, so the card says the length once.
    const card = page.getByRole('region', {
      name: 'Your ask Pro+, 4 weeks · USD 47.50',
      exact: true,
    });
    await expect(card.getByRole('button', { name: 'I’ve paid' })).toBeVisible();
    await expect(card.getByRole('button', { name: 'Copy the Whish number' })).toBeVisible();
    await expect(page.locator('[data-plans-to-add]')).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
    await expectNoAxeViolations(page);
    await page.screenshot({
      path: test.info().outputPath('n9c2-plan-asked-1440.png'),
      fullPage: true,
    });
  });

  test('the trainee’s page keeps inside the screen at 200% text', async ({ page }) => {
    await openTraineePlan(page, {
      plans: [BOOKED_PLAN],
      house: { ...ASKS_ON, asks: [askOf(PRO_4_WEEKS), BOOKED, CLOSED] },
    });
    await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });

    await expect(page.getByRole('region', { name: /^Your ask/ })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Earlier asks' })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await page.screenshot({
      path: test.info().outputPath('n9c2-plan-200-percent-390.png'),
      fullPage: true,
    });
  });

  test('the Ask sheet scrolls from the keyboard at 200% text, its words being one focusable region', async ({
    page,
  }) => {
    await openTraineePlan(page, { house: ASKS_ON });
    await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });

    await page.getByRole('button', { name: 'Ask for Two blocks, Pro+' }).click();
    const confirm = page.getByRole('dialog', { name: 'Ask for Pro+' });
    const words = confirm.getByRole('region', { name: 'The plan you ask for' });
    await expect(words).toContainText('Free keeps running underneath.');
    await expect(words).toHaveAttribute('tabindex', '0');
    // The words outgrow the sheet at 200% text, so its body scrolls: the region is how a keyboard does it.
    const body = confirm.locator('.tb-modal__body');
    await expect
      .poll(() => body.evaluate((element) => element.scrollHeight > element.clientHeight))
      .toBe(true);
    await words.focus();
    await expect(words).toBeFocused();
    await expectNoHorizontalOverflow(page);
    await expectNoAxeViolations(page);
    await page.screenshot({
      path: test.info().outputPath('n9c2-plan-ask-sheet-200-percent-390.png'),
    });
  });

  test('a 20-digit Whish number wraps inside the card at 200% text, never cut off', async ({
    page,
  }) => {
    const long = '96170123456789012345';
    const asks: Record<string, unknown>[] = [askOf(PRO_TWO_BLOCKS)];
    await openTraineePlan(page, { house: () => ({ ...ASKS_ON, whishNumber: long, asks }) });
    await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });

    // The card clips what overflows it, so the page never scrolls sideways: the number's own edges are read.
    const inside = async () => {
      const card = page.locator('[data-open-ask] .plan-head');
      const box = (await card.boundingBox())!;
      const numbers = card.locator('.whish-number');
      await expect(numbers).not.toHaveCount(0);
      for (const number of await numbers.all()) {
        const edge = await number.evaluate((element) => {
          const rect = element.getBoundingClientRect();
          return {
            left: rect.left,
            right: rect.right,
            scroll: element.scrollWidth - element.clientWidth,
          };
        });
        expect(edge.left).toBeGreaterThanOrEqual(box.x);
        expect(edge.right).toBeLessThanOrEqual(box.x + box.width);
        expect(edge.scroll).toBeLessThanOrEqual(0);
      }
    };
    await expect(page.locator('[data-open-ask] strong.whish-number')).toHaveText(long);
    await inside();
    await expectNoHorizontalOverflow(page);
    await page.screenshot({
      path: test.info().outputPath('n9c2-plan-long-whish-200-percent-390.png'),
      fullPage: true,
    });

    // The trainee's own 20-digit number, once they said they sent the money from it.
    asks[0] = {
      ...asks[0],
      state: 'MoneySent',
      moneySent: { whishName: 'Rima Aboud', whishNumber: long, sentOn: '2026-10-15' },
    };
    await page.reload();
    await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
    await expect(page.locator('[data-open-ask] bdi.whish-number')).toHaveText(long);
    await inside();
    await expectNoHorizontalOverflow(page);
    await page.screenshot({
      path: test.info().outputPath('n9c2-plan-long-whish-sent-200-percent-390.png'),
      fullPage: true,
    });
  });

  test.describe('when the server refuses or fails', () => {
    test.use({
      allowedConsoleErrors: {
        patterns: [
          /status of 409 .*\/api\/house-plans\/me\/asks/,
          /status of 500 .*\/api\/house-plans\/me/,
        ],
      },
    });

    test('a refused ask says the server’s words in the sheet, and the page reads the plans again', async ({
      page,
    }) => {
      let reads = 0;
      const message =
        'You already asked for Pro+, 4 weeks. TB Gym books it once your money is there, or closes the ask, before you can ask for anything else.';
      await openTraineePlan(page, {
        house: () => {
          reads += 1;
          return reads === 1 ? ASKS_ON : { ...ASKS_ON, asks: [askOf(PRO_4_WEEKS)] };
        },
        extra: {
          'POST /api/house-plans/me/asks': (route) =>
            json(route, 409, { code: 'house_plan_ask_open', message }),
        },
      });

      await page.getByRole('button', { name: 'Ask for Two blocks, Pro+' }).click();
      const confirm = page.getByRole('dialog', { name: 'Ask for Pro+' });
      await confirm.getByRole('button', { name: 'Ask for it' }).click();
      const summary = confirm.getByRole('alert');
      await expect(summary).toHaveText(message);
      await expect(summary).toBeFocused();
      await expectNoAxeViolations(page);
      await confirm.getByRole('button', { name: 'Not now' }).click();

      await expect(confirm).toHaveCount(0);
      await expect(
        page.getByRole('region', { name: 'Your ask Pro+, 4 weeks · USD 47.50', exact: true }),
      ).toBeVisible();
      await expect(page.locator('[data-plans-to-add]')).toHaveCount(0);
      expect(reads).toBe(2);
    });

    test('a failed read of the plans for sale says so in their place alone, and Try again reads them', async ({
      page,
    }) => {
      let reads = 0;
      await openTraineePlan(page, {
        extra: {
          'GET /api/house-plans/me': (route) => {
            reads += 1;
            return reads === 1
              ? json(route, 500, { title: 'Nope' })
              : json(route, 200, { today: '2026-10-15', ...ASKS_ON });
          },
        },
      });

      const failed = page.locator('[data-house-failed]');
      await expect(failed.getByRole('alert')).toHaveText(
        'The plans TB Gym sells couldn’t be loaded.',
      );
      await expect(page.getByText('Your plan couldn’t be loaded.')).toHaveCount(0);
      await expectNoAxeViolations(page);
      await failed.getByRole('button', { name: 'Try again' }).click();

      await expect(page.getByRole('region', { name: 'Plans you can add' })).toBeVisible();
      await expect(failed).toHaveCount(0);
      expect(reads).toBe(2);
    });
  });
});

// ---------- the website's link is the coach's alone (notes plan N2) ----------

test.describe('TB Gym’s website from a client’s side (notes plan N2)', () => {
  const TODAY = '2026-09-20';

  /**
   * What the homepage reads at /about, and a client's Today with training alone and nothing
   * assigned, which is where Back to Today leads.
   */
  const WEBSITE_AND_TODAY: Record<string, Handler> = {
    'GET /api/website/settings': (route) => json(route, 200, NO_WEBSITE_SETTINGS),
    'GET /api/website/contact-form': (route) => json(route, 200, { stamp: 'e2e-stamp' }),
    'GET /api/client-access/me': (route) =>
      json(
        route,
        200,
        FEATURES.map((feature) => ({
          feature,
          isAllowed: feature === 'Training',
          reason: feature === 'Training' ? 'Granted' : 'NoEntitlement',
        })),
      ),
    'GET /api/training/me/today': (route) =>
      json(route, 200, {
        isAllowed: true,
        accessReason: 'Granted',
        localDate: TODAY,
        workouts: [],
      }),
    'GET /api/training/me/upcoming': (route) =>
      json(route, 200, {
        isAllowed: true,
        accessReason: 'Granted',
        localDate: TODAY,
        timeZoneId: 'Asia/Beirut',
        hasAssignedProgram: false,
        hasVisibleSessions: true,
        searchThrough: '2026-12-19',
        nextSession: null,
        unfinishedWorkouts: [],
        nextSkip: null,
        todayCoverage: { activeBlock: null, nextBlockStartDate: null },
      }),
    'GET /api/training/me/week': (route) =>
      json(route, 200, {
        isAllowed: true,
        accessReason: 'Granted',
        localDate: TODAY,
        weekStart: '2026-09-14',
        days: ['14', '15', '16', '17', '18', '19', '20'].map((date) => ({
          date: `2026-09-${date}`,
          scheduled: 0,
          completed: 0,
        })),
      }),
    'GET /api/client-renewal/me': (route) =>
      json(route, 200, {
        planEnded: false,
        endedOn: null,
        coachName: null,
        lastRequest: null,
        canAsk: false,
      }),
    'GET /api/client-plan/me': (route) =>
      json(route, 200, { today: TODAY, plans: [], coachName: 'Lea Haddad' }),
    // Today looks for the coach's newest message.
    'GET /api/messaging/conversations': (route) =>
      json(route, 200, {
        items: [],
        hasMore: false,
        nextBeforeActivityAtUtc: null,
        nextBeforeConversationId: null,
      }),
  };

  for (const [width, height] of [
    [390, 844],
    [1440, 900],
  ] as const) {
    test(`a client’s Me at ${width}px has no link to TB Gym’s website or to What changed`, async ({
      page,
    }) => {
      await openMe(page, { width, height });

      await expect(page.getByRole('link', { name: /Password and security/ })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
      await expect(page.getByRole('link', { name: /TB Gym website/ })).toHaveCount(0);
      await expect(page.getByRole('link', { name: /What changed/ })).toHaveCount(0);
      await expect(page.getByText('TB Gym website')).toHaveCount(0);
      await expect(page.getByText('What changed')).toHaveCount(0);
      await expect(page.locator('a[href="/about"]')).toHaveCount(0);
      await expect(page.locator('a[href="/changelog"]')).toHaveCount(0);
      // Nor do the client's tabs: the tabs are there, and the page holds no such address.
      await expect(page.locator('app-client-tabs')).toBeVisible();
      await expect(page.locator('#website-menu-heading')).toHaveCount(0);
    });
  }

  test('a client who types /about at 390px sees the homepage without the tabs, and Back to Today in its menu returns to Today with them', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockClient(page, { extra: WEBSITE_AND_TODAY });
    await page.goto('/about');
    await waitForFonts(page);

    await expect(page.getByRole('heading', { level: 1, name: /Coach both/ })).toBeVisible();
    await expect(page).toHaveURL('/about');
    // The page fills the window as a visitor sees it: no tabs under it, no bar over it.
    await expect(page.locator('app-client-tabs')).toHaveCount(0);
    await expect(page.locator('.frame-tabs')).toHaveCount(0);
    await expect(page.locator('.topbar')).toHaveCount(0);
    // Signed in, the page offers no sign-up and no sign-in.
    await expect(page.locator('a[href="/auth/register"]')).toHaveCount(0);
    await expect(page.locator('a[href="/auth/sign-in"]')).toHaveCount(0);
    await expect(page.getByText('Start your coaching space')).toHaveCount(0);
    await expectNoHorizontalOverflow(page);

    // In the installed app there is no browser Back: this row is the way out.
    const header = page.locator('app-home-header');
    await header.getByRole('button', { name: 'Menu' }).click();
    await expect(page.locator('#home-menu a')).toHaveText([
      'The week',
      "What's inside",
      'For gyms',
      'Back to Today',
    ]);
    const back = page.locator('#home-menu').getByRole('link', { name: 'Back to Today' });
    await expect(back).toBeVisible();
    await expect(back).toBeInViewport({ ratio: 1 });
    await expect(back).toHaveAttribute('href', '/');
    await page.screenshot({ path: 'test-results/n2-client-about-menu-390.png' });
    await back.click();

    await expect(page).toHaveURL('/');
    await expect(page).toHaveTitle('Today | TB Gym');
    await expect(page.locator('app-client-tabs')).toBeVisible();
    await expect(page.locator('app-client-tabs a[aria-current="page"]')).toHaveAttribute(
      'href',
      '/',
    );
    await expect(page.locator('#today-training-heading')).toHaveText('Nothing assigned yet');
    await expect(page.locator('app-home-header')).toHaveCount(0);
    await expect(page.locator('meta[name="robots"]')).toHaveCount(0);
  });
});
