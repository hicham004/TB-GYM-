import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import {
  expect,
  expectNoHorizontalOverflow,
  json,
  mockSignedOut,
  test,
  useRtl,
  waitForFonts,
} from './support';

/**
 * The signed-out screens: sign-in, coach registration, forgot and reset password, email confirmation
 * and invitation acceptance, which share `app-auth-frame`. Every API answer is a test-only mock;
 * the screens' own guards and form logic run unchanged. Pixel baselines for sign-in and registration
 * live in `existing-routes.e2e.ts`.
 */

const INVITATION = {
  kind: 'Client',
  workspaceName: 'Atlas Performance',
  firstName: 'Rana',
  lastName: 'Haddad',
  email: 'rana@example.test',
  expiresAtUtc: '2026-10-02T09:00:00Z',
  status: 'Pending',
  requiresExistingAccountSignIn: false,
};

/** Signed out, plus the one extra answer a screen needs. */
async function signedOutWith(page: Page, method: string, path: string, status: number, body = {}) {
  await mockSignedOut(page);
  await page.route(`**${path}`, (route) =>
    route.request().method() === method ? json(route, status, body) : route.fallback(),
  );
}

async function ready(page: Page): Promise<void> {
  await expect(page.locator('h1')).toBeVisible();
  await waitForFonts(page);
  await page.evaluate(() => document.fonts.load('italic 400 14px "TB Home Serif"'));
}

async function expectAccessible(page: Page): Promise<void> {
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
    .analyze();
  expect(result.violations).toEqual([]);
}

/** Each screen in the state a person lands on, and in the error state its form or link can reach. */
const SCREENS: {
  name: string;
  open: (page: Page) => Promise<void>;
  fail: (page: Page) => Promise<void>;
}[] = [
  {
    name: 'sign-in',
    open: async (page) => {
      await signedOutWith(page, 'POST', '/api/auth/login', 401, { title: 'Unauthorized' });
      await page.goto('/auth/sign-in');
    },
    fail: async (page) => {
      await page.getByLabel('Email').fill('coach@example.test');
      await page.getByLabel('Password', { exact: true }).fill('not-the-password');
      await page.getByRole('button', { name: 'Sign in' }).click();
      await expect(page.getByRole('alert')).toContainText('Email or password is incorrect.');
    },
  },
  {
    name: 'coach registration',
    open: async (page) => {
      await signedOutWith(page, 'POST', '/api/auth/register/coach', 400, {
        message: 'Registration could not be completed.',
      });
      await page.goto('/auth/register');
    },
    fail: async (page) => {
      await page.getByRole('button', { name: 'Create coach account' }).click();
      await expect(page.getByRole('alert')).toContainText(
        "Your coaching space can't be created yet",
      );
    },
  },
  {
    name: 'forgot password',
    open: async (page) => {
      await signedOutWith(page, 'POST', '/api/auth/forgot-password', 500);
      await page.goto('/auth/forgot-password');
    },
    fail: async (page) => {
      await page.getByLabel('Email').fill('coach@example.test');
      await page.getByRole('button', { name: 'Send reset link' }).click();
      await expect(page.getByRole('alert')).toContainText('could not be sent');
    },
  },
  {
    name: 'reset password',
    open: async (page) => {
      await signedOutWith(page, 'POST', '/api/auth/reset-password', 400);
      await page.goto('/auth/reset-password?userId=user-1&code=reset-code');
    },
    fail: async (page) => {
      await page.getByLabel('New password', { exact: true }).fill('correct-horse-battery');
      await page.getByLabel('Confirm new password', { exact: true }).fill('correct-horse-battery');
      await page.getByRole('button', { name: 'Update password' }).click();
      await expect(page.getByRole('alert')).toContainText('invalid or expired');
    },
  },
  {
    name: 'confirm email',
    open: async (page) => {
      await signedOutWith(page, 'POST', '/api/auth/confirm-email', 400);
      await page.goto('/auth/confirm-email?userId=user-1&code=confirm-code');
    },
    fail: async (page) => {
      await expect(page.getByText('invalid or expired')).toBeVisible();
    },
  },
  {
    name: 'invitation',
    open: async (page) => {
      await signedOutWith(page, 'GET', '/api/invitations/public/invite-token', 200, INVITATION);
      await page.route('**/api/invitations/accept', (route) =>
        json(route, 409, { message: 'This invitation could not be accepted.' }),
      );
      await page.goto('/invite?token=invite-token');
    },
    fail: async (page) => {
      await page.getByLabel('Password', { exact: true }).fill('correct-horse-battery');
      await page.getByLabel('Confirm password', { exact: true }).fill('correct-horse-battery');
      await page.getByRole('button', { name: 'Create account and join' }).click();
      await expect(page.getByRole('alert')).toContainText('could not be accepted');
    },
  },
];

// The error states log their failed request, which is the point of them.
test.use({
  allowedConsoleErrors: {
    patterns: [/status of 401 .*\/api\/auth\/me/, /status of (400|401|409|500)/],
  },
});

for (const width of [390, 1440]) {
  for (const screen of SCREENS) {
    test(`${screen.name} at ${width}px is accessible before and after an error`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await screen.open(page);
      await ready(page);
      await expectNoHorizontalOverflow(page);
      await expectAccessible(page);

      await screen.fail(page);
      await expectNoHorizontalOverflow(page);
      await expectAccessible(page);
    });
  }
}

test('a phone never downloads the photo panel', async ({ page }) => {
  const photos: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/images/')) photos.push(request.url());
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await mockSignedOut(page);
  await page.goto('/auth/sign-in');
  await ready(page);
  await page.waitForLoadState('networkidle');

  expect(photos).toEqual([]);
});

test('the desktop photo panel sits at the inline end and mirrors in right-to-left', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockSignedOut(page);
  await page.goto('/auth/sign-in');
  await ready(page);

  const form = page.locator('form');
  const panel = page.locator('.auth__panel');
  await expect(panel).toBeVisible();
  expect((await panel.boundingBox())!.x).toBeGreaterThan((await form.boundingBox())!.x);

  await useRtl(page);
  expect((await panel.boundingBox())!.x).toBeLessThan((await form.boundingBox())!.x);
  await expectNoHorizontalOverflow(page);
});

test('sign-in is keyboard operable with the design-system focus ring', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockSignedOut(page);
  await page.goto('/auth/sign-in');
  await ready(page);

  const order = [
    page.getByRole('link', { name: 'TB Gym' }),
    page.getByLabel('Email'),
    page.getByLabel('Password', { exact: true }),
    page.getByRole('button', { name: 'Show password' }),
    page.getByLabel('Keep me signed in'),
    page.getByRole('link', { name: 'Forgot password?' }),
    page.getByRole('button', { name: 'Sign in' }),
    page.getByRole('link', { name: 'Create your coaching space' }),
  ];
  for (const target of order) {
    await page.keyboard.press('Tab');
    await expect(target).toBeFocused();
    const ring = await target.evaluate((element) => {
      const style = getComputedStyle(element);
      return `${style.outlineStyle} ${style.outlineWidth} ${style.outlineColor}`;
    });
    expect(ring).toBe('solid 3px rgb(21, 61, 51)');
  }

  // The toggle reveals the password and says so; Enter on a field submits the form.
  await page.getByLabel('Password', { exact: true }).fill('secret-value');
  await page.getByRole('button', { name: 'Show password' }).press('Enter');
  await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute('type', 'text');
  await expect(page.getByRole('button', { name: 'Hide password' })).toBeVisible();
});

test('a refused sign-in names each field and moves focus to the summary', async ({ page }) => {
  await mockSignedOut(page);
  await page.goto('/auth/sign-in');
  await ready(page);

  await page.getByLabel('Email').press('Enter');

  const summary = page.getByRole('alert');
  await expect(summary).toBeFocused();
  await expect(summary).toContainText('Enter your email address.');
  await expect(summary).toContainText('Enter your password.');
  const email = page.getByLabel('Email');
  await expect(email).toHaveAttribute('aria-invalid', 'true');
  await expect(email).toHaveAccessibleDescription('Enter your email address.');
});

test('every signed-out screen reflows at 200% text on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const screen of SCREENS) {
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await screen.open(page);
    await ready(page);
    await page.evaluate(() => (document.documentElement.style.fontSize = '32px'));
    await expectNoHorizontalOverflow(page);
  }
});
