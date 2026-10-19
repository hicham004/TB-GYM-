import { expect, requireLive, signIn, test, uniqueEmail } from './support';

/**
 * Coach registration end to end against the real API: the account is created, signing in before
 * the address is confirmed is refused in plain words, the development confirmation link confirms
 * it and leaves the address bar, and the first sign-in lands on an empty Today that invites the
 * first client. A rerun registers a new address every time.
 */
requireLive();

test('a coach registers, confirms through the development link, signs in and sees the empty Today', async ({
  page,
}) => {
  const email = uniqueEmail('coach');
  const password = 'Live-Coach-2026!';

  await page.goto('/auth/register');
  await page.getByLabel('Your name').fill('Live Coach');
  await page.getByLabel('Coaching space name').fill('Live Coaching');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByLabel('Confirm password').fill(password);
  const registered = page.waitForResponse((response) =>
    response.url().includes('/api/auth/register/coach'),
  );
  await page.getByRole('button', { name: 'Create coach account' }).click();
  const response = await registered;
  expect(response.status()).toBe(202);
  const body = (await response.json()) as {
    email: string;
    developmentConfirmationUrl: string | null;
  };
  expect(body.email).toBe(email);
  await expect(page.getByText('Check your email')).toBeVisible();
  await expect(page.getByText(`We queued a confirmation link for ${email}.`)).toBeVisible();

  // Signing in before confirming is refused with one clear sentence.
  await page.goto('/auth/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('#sign-in-summary')).toHaveText(
    'Confirm your email before signing in.',
  );

  test.skip(
    !body.developmentConfirmationUrl,
    'The API returned no development confirmation link (a production mail provider sends it).',
  );
  const confirmUrl = body.developmentConfirmationUrl as string;
  expect(confirmUrl).toContain('/auth/confirm-email?');

  // The link confirms the address, and the token is removed from the address bar.
  await page.goto(confirmUrl);
  await expect(page.getByText('Email confirmed')).toBeVisible();
  expect(page.url()).not.toContain('code=');
  expect(await page.evaluate(() => JSON.stringify([localStorage, sessionStorage]))).not.toContain(
    'code',
  );

  await signIn(page, email, password);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(
    /Good (morning|afternoon|evening)/,
  );
  await expect(page.getByRole('link', { name: 'Invite your first client' })).toHaveAttribute(
    'href',
    '/invitations',
  );
});
