import {
  ACCOUNTS,
  api,
  DEMO_PASSWORD,
  expect,
  memberships,
  requireLive,
  signIn,
  test,
} from './support';

/**
 * Me against a live API (M8, CLI-017): Appearance and Body weight save on the account and follow
 * the client to another signed-in browser; notification settings refuse a stale save; a password
 * change works and "Sign out everywhere" ends the other browser's session. Every change is put back
 * at the end (in a finally), so a rerun starts from the demo's own state.
 */
requireLive();

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

const CLIENT = ACCOUNTS.hadi;
const TEMP_PASSWORD = 'LiveCheck-Temp-2026!x';

test('Appearance and Body weight are saved on the account and followed elsewhere', async ({
  page,
  browser,
}) => {
  await signIn(page, CLIENT);
  await page.goto('/me');
  await expect(page.getByRole('heading', { name: 'Me' })).toBeVisible();
  try {
    await page.getByRole('radio', { name: 'Dark' }).click();
    await expect
      .poll(
        async () =>
          (await api<{ preferredThemeMode: string }>(page, 'GET', '/api/auth/me')).body
            .preferredThemeMode,
      )
      .toBe('dark');
    await expect
      .poll(() => page.evaluate(() => getComputedStyle(document.documentElement).colorScheme))
      .toBe('dark');

    const other = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      locale: 'en-US',
      timezoneId: 'Asia/Beirut',
      baseURL: process.env['TB_GYM_LIVE_URL'],
    });
    const second = await other.newPage();
    await signIn(second, CLIENT);
    await expect
      .poll(() => second.evaluate(() => getComputedStyle(document.documentElement).colorScheme))
      .toBe('dark');
    await second.goto('/me');
    await expect(second.getByRole('radio', { name: 'Dark' })).toBeChecked();
    await other.close();

    await page.getByRole('radio', { name: 'lb' }).click();
    await expect
      .poll(
        async () =>
          (await api<{ preferredWeightUnit: string }>(page, 'GET', '/api/auth/me')).body
            .preferredWeightUnit,
      )
      .toBe('Pound');
    await expect(page.locator('.pref-error')).toHaveText('');
  } finally {
    await api(page, 'PUT', '/api/auth/me/theme', { body: { mode: 'system' } });
    await api(page, 'PUT', '/api/auth/me/weight-unit', { body: { unit: 'Kilogram' } });
  }
});

test('notification settings refuse a stale save from a second tab', async ({ page, context }) => {
  await signIn(page, CLIENT);
  const tenantId = (await memberships(page))[0].tenantId;
  const original = await api<Record<string, unknown>>(
    page,
    'GET',
    '/api/notifications/preferences',
    {
      tenantId,
    },
  );
  expect(original.status).toBe(200);
  await page.goto('/notifications/settings');
  await expect(page.getByRole('heading', { name: 'Notification settings' })).toBeVisible();
  const second = await context.newPage();
  await second.goto('/notifications/settings');
  await expect(second.getByRole('heading', { name: 'Notification settings' })).toBeVisible();
  try {
    const quiet = page.getByLabel('Hold emails during quiet hours');
    await quiet.click();
    if (await quiet.isChecked()) {
      await page.getByLabel('From').fill('22:00');
      await page.getByLabel('Until').fill('07:00');
    }
    await page.getByRole('button', { name: 'Save settings' }).click();
    await expect(page.getByText('Your notification settings were saved.')).toBeVisible();

    await second.getByLabel('Email me about my coaching plan').click();
    await second.getByRole('button', { name: 'Save settings' }).click();
    await expect(
      second.getByText(
        'Your notification settings were changed by another request. Reload and try again.',
      ),
    ).toBeVisible();
  } finally {
    await second.close();
    const current = await api<Record<string, unknown>>(
      page,
      'GET',
      '/api/notifications/preferences',
      {
        tenantId,
      },
    );
    await api(page, 'PUT', '/api/notifications/preferences', {
      tenantId,
      body: {
        emailMarketingEnabled: original.body['emailMarketingEnabled'],
        quietHoursEnabled: original.body['quietHoursEnabled'],
        quietHoursStartLocal: original.body['quietHoursStartLocal'],
        quietHoursEndLocal: original.body['quietHoursEndLocal'],
        version: current.body['version'],
      },
    });
  }
});

test('a password change works and Sign out everywhere ends the other session', async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  await signIn(page, CLIENT);
  await page.goto('/account/security');
  await expect(page.getByRole('heading', { name: 'Password and security' })).toBeVisible();
  let changed = false;
  try {
    await page.getByLabel('Current password').fill('WrongPassword-1!');
    await page.getByLabel('New password', { exact: true }).fill(TEMP_PASSWORD);
    await page.getByLabel('New password again').fill(TEMP_PASSWORD);
    await page.getByRole('button', { name: 'Change password' }).click();
    await expect(page.getByText('Incorrect password.')).toBeVisible();

    await page.getByLabel('Current password').fill(DEMO_PASSWORD);
    await page.getByRole('button', { name: 'Change password' }).click();
    await expect(
      page.getByText('Password changed. Use the new one next time you sign in.'),
    ).toBeVisible();
    changed = true;

    const other = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      locale: 'en-US',
      timezoneId: 'Asia/Beirut',
      baseURL: process.env['TB_GYM_LIVE_URL'],
    });
    const second = await other.newPage();
    await signIn(second, CLIENT, TEMP_PASSWORD);
    expect((await api(second, 'GET', '/api/auth/me')).status).toBe(200);

    await page.locator('[data-sign-out-everywhere]').click();
    await expect(page.locator('app-confirm')).toContainText('this one too');
    await page.locator('app-confirm button', { hasText: 'Sign out everywhere' }).click();
    await page.waitForURL((url) => url.pathname.startsWith('/auth'), { timeout: 30_000 });
    await expect.poll(async () => (await api(second, 'GET', '/api/auth/me')).status).toBe(401);
    await other.close();
  } finally {
    if (changed) {
      await signIn(page, CLIENT, TEMP_PASSWORD);
      await page.goto('/account/security');
      await page.getByLabel('Current password').fill(TEMP_PASSWORD);
      await page.getByLabel('New password', { exact: true }).fill(DEMO_PASSWORD);
      await page.getByLabel('New password again').fill(DEMO_PASSWORD);
      await page.getByRole('button', { name: 'Change password' }).click();
      await expect(
        page.getByText('Password changed. Use the new one next time you sign in.'),
      ).toBeVisible();
    }
  }
});
