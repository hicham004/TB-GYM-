import { ACCOUNTS, api, expect, requireLive, test, uniqueEmail } from './support';

/**
 * Sign-in and password recovery against the real API: a wrong password is answered in plain
 * words, forgot-password answers a known and an unknown address identically (NOT-029), and a bad
 * reset token fails safely and clears the password fields.
 */
requireLive();

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
