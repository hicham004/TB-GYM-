import AxeBuilder from '@axe-core/playwright';
import type { Page, Route } from '@playwright/test';
import {
  expect,
  expectNoHorizontalOverflow,
  json,
  mockSession,
  mockSignedOut,
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
      'GET /api/client-profile/me/coach': (route) => json(route, 200, { name: 'Lea Haddad' }),
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
      patterns: [/status of 401 .*\/api\/auth\/me/, /status of 500 .*\/api\/auth\/me\/weight-unit/],
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
      patterns: [
        /status of 401 .*\/api\/auth\/me/,
        /status of 403 .*\/api\/client-profile\/me\/coach/,
      ],
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
    allowedConsoleErrors: { patterns: [/status of 401 .*\/api\/auth\/me/, /@vite\/client/] },
  });

  test('an installed app draws it from index.html until the script arrives', async ({ page }) => {
    await mockSignedOut(page);
    // The media condition cannot be emulated, so the page is served with it removed: this proves the
    // rule, the picture and the colours. That the screen is shown only when installed is the
    // browser's own `display-mode`.
    await page.route('**/main.js', () => new Promise<void>(() => undefined));
    await page.route('**/', async (route) => {
      if (route.request().resourceType() !== 'document') return route.fallback();
      const response = await route.fetch();
      const html = (await response.text()).replaceAll('(display-mode: standalone)', 'all');
      await route.fulfill({ response, body: html });
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/', { waitUntil: 'commit' });
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
