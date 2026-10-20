import type { Page } from '@playwright/test';
import { ACCOUNTS, api, expect, requireLive, signIn, test, uniqueEmail } from './support';

/**
 * Sign-in and password recovery against the real API: a wrong password is answered in plain
 * words, forgot-password answers a known and an unknown address identically (NOT-029), a bad
 * reset token fails safely and clears the password fields, a locked account is told so even with
 * the right password (AUTH-2), and a session ended from another device takes the open app to
 * sign-in and back (WEB-1). The last two use a new account, so no demo account is locked or
 * signed out.
 */
requireLive();

const NEW_PASSWORD = 'Live-Session-2026!';

/** Registers a coach and confirms the address through the development link. */
async function confirmedCoach(page: Page, prefix: string): Promise<string> {
  const email = uniqueEmail(prefix);
  await page.goto('/auth/sign-in');
  const registered = await api<{ developmentConfirmationUrl: string | null }>(
    page,
    'POST',
    '/api/auth/register/coach',
    {
      body: {
        displayName: 'Live Session Coach',
        email,
        password: NEW_PASSWORD,
        workspaceName: 'Live Session Coaching',
        timeZoneId: 'Asia/Beirut',
        defaultCulture: 'en-LB',
        defaultCurrencyCode: 'USD',
        weekStartsOn: 'Monday',
      },
    },
  );
  expect(registered.status).toBe(202);
  test.skip(
    !registered.body.developmentConfirmationUrl,
    'The API returned no development confirmation link (a production mail provider sends it).',
  );
  await page.goto(registered.body.developmentConfirmationUrl as string);
  await expect(page.getByText('Email confirmed')).toBeVisible();
  return email;
}

/** Submits the sign-in form as it is and returns the login answer's status. */
async function submitSignIn(page: Page, email: string, password: string): Promise<number> {
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  const [login] = await Promise.all([
    page.waitForResponse((response) => response.url().endsWith('/api/auth/login')),
    page.getByRole('button', { name: 'Sign in' }).click(),
  ]);
  return login.status();
}

test('a wrong password is answered in plain words', async ({ page }) => {
  await page.goto('/auth/sign-in');
  await page.getByLabel('Email').fill(ACCOUNTS.coachLea);
  await page.getByLabel('Password', { exact: true }).fill('Not-The-Password-2026!');
  const login = page.waitForResponse((response) => response.url().includes('/api/auth/login'));
  await page.getByRole('button', { name: 'Sign in' }).click();
  expect((await login).status()).toBe(401);
  await expect(page.locator('#sign-in-summary')).toHaveText('Email or password is incorrect.');
  expect(page.url()).toContain('/auth/sign-in');
});

test('forgot password answers the same for a known and an unknown address', async ({ page }) => {
  await page.goto('/auth/sign-in');
  const known = await api<{ message: string; developmentActionUrl: string | null }>(
    page,
    'POST',
    '/api/auth/forgot-password',
    { body: { email: ACCOUNTS.coachLea } },
  );
  const unknown = await api<{ message: string; developmentActionUrl: string | null }>(
    page,
    'POST',
    '/api/auth/forgot-password',
    { body: { email: uniqueEmail('nobody') } },
  );
  expect(known.status).toBe(202);
  expect(unknown.status).toBe(202);
  expect(unknown.body).toEqual(known.body);
  // No link is ever returned for recovery, in any environment (NOT-029).
  expect(known.body.developmentActionUrl).toBeNull();

  // The screen says the same thing for either address.
  await page.goto('/auth/forgot-password');
  await page.getByLabel('Email').fill(uniqueEmail('nobody'));
  await page.getByRole('button', { name: 'Send reset link' }).click();
  await expect(page.getByText('Check your email')).toBeVisible();
  await expect(page.getByText(known.body.message)).toBeVisible();
});

test('a bad reset token fails safely and clears the password fields', async ({ page }) => {
  await page.goto(
    '/auth/reset-password?userId=0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0&code=Q0ZESjhub3R2YWxpZA',
  );
  const password = 'Live-Reset-2026!';
  await page.getByLabel('New password', { exact: true }).fill(password);
  await page.getByLabel('Confirm new password').fill(password);
  const reset = page.waitForResponse((response) =>
    response.url().includes('/api/auth/reset-password'),
  );
  await page.getByRole('button', { name: 'Update password' }).click();
  expect((await reset).status()).toBe(400);
  await expect(page.locator('#reset-summary')).toHaveText('The link is invalid or expired.');
  await expect(page.locator('#reset-password')).toHaveValue('');
  await expect(page.locator('#reset-confirm-password')).toHaveValue('');
  // The spent token leaves the address bar by history replacement.
  expect(page.url()).not.toContain('code=');
});

test('a locked account is told it is locked, even when the password is right', async ({ page }) => {
  const email = await confirmedCoach(page, 'locked');
  await page.goto('/auth/sign-in');

  for (let attempt = 1; attempt <= 4; attempt++) {
    expect(await submitSignIn(page, email, 'Not-The-Password-2026!')).toBe(401);
    await expect(page.locator('#sign-in-summary')).toHaveText('Email or password is incorrect.');
  }

  // The fifth wrong password locks the account for fifteen minutes, and the screen says so.
  expect(await submitSignIn(page, email, 'Not-The-Password-2026!')).toBe(429);
  await expect(page.locator('#sign-in-summary')).toHaveText(
    'This account is locked after too many wrong passwords. Try again in 15 minutes.',
  );

  // The right password is not called wrong while the lock lasts.
  expect(await submitSignIn(page, email, NEW_PASSWORD)).toBe(429);
  await expect(page.locator('#sign-in-summary')).toHaveText(
    /^This account is locked after too many wrong passwords\. Try again in 1[45] minutes\.$/,
  );
  expect(page.url()).toContain('/auth/sign-in');
});

test('a session ended from another device takes the open app to sign-in and back', async ({
  page,
  browser,
}) => {
  const email = await confirmedCoach(page, 'ended');
  await signIn(page, email, NEW_PASSWORD);

  // The same person signs out everywhere from a second device.
  const elsewhere = await browser.newContext();
  const phone = await elsewhere.newPage();
  await signIn(phone, email, NEW_PASSWORD);
  expect((await api(phone, 'POST', '/api/auth/sessions/revoke-all')).status).toBe(204);
  await elsewhere.close();

  // The open app's next request is refused, and it goes to sign-in instead of failing in place.
  await page.getByRole('link', { name: 'Clients' }).first().click();
  await page.waitForURL((url) => url.pathname === '/auth/sign-in');
  const ended = new URL(page.url());
  expect(ended.searchParams.get('returnUrl')).toBe('/clients');
  expect(ended.searchParams.get('reason')).toBe('session-ended');
  await expect(
    page.getByText('You were signed out. Sign in again to carry on where you left off.'),
  ).toBeVisible();

  // Signing in again goes back to the page the person was on.
  expect(await submitSignIn(page, email, NEW_PASSWORD)).toBe(200);
  await page.waitForURL((url) => url.pathname === '/clients');
  await expect(page.locator('h1').first()).toBeVisible();
});
