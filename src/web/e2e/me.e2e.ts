import AxeBuilder from '@axe-core/playwright';
import type { Locator, Page, Route } from '@playwright/test';
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
  const signOut = page.getByRole('button', { name: 'Sign out' });
  await signOut.scrollIntoViewIfNeeded();
  await expect(signOut).toBeVisible();
  // The tab bar sticks to the bottom, so the last control must end above it.
  const box = await signOut.boundingBox();
  const tabs = await page.locator('app-client-tabs').boundingBox();
  expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual((tabs?.y ?? 0) + 1);
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
