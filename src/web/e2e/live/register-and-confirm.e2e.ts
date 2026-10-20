import { expect, requireLive, signIn, test, uniqueEmail } from './support';

/**
 * Coach registration end to end against the real API: the time zone is found by city and the
 * currency chosen as Settings › Name and region chooses them (AUTH-5), the account is created,
 * signing in before the address is confirmed is refused in plain words, only to someone who knows
 * the password (BEB-4), the development confirmation link confirms it and leaves the address bar,
 * the first sign-in lands on an empty Today that invites the first client, and the space keeps the
 * zone and currency picked. A rerun registers a new address every time.
 */
requireLive();

test('a coach registers in a zone and currency they pick, confirms, signs in and sees the empty Today', async ({
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

  // The zone starts as this browser's and is found by city in a sheet (audit AUTH-5).
  await expect(page.locator('[data-zone] strong')).toHaveText('Beirut, Asia');
  await page.getByRole('button', { name: 'Change' }).click();
  const zones = page.getByRole('dialog', { name: 'Time zone' });
  await zones.getByLabel('Search by city').fill('dubai');
  await zones.getByRole('button', { name: /^Dubai/ }).click();
  await expect(zones).toBeHidden();
  await expect(page.locator('[data-zone] strong')).toHaveText('Dubai, Asia');
  // The currency in one tap, or by its code under Another.
  await page.getByRole('radio', { name: 'Another' }).check();
  await page.getByLabel('Currency code').fill('aed');
  await expect(page.locator('[data-currency-line]')).toContainText('(AED)');
  await expect(page.locator('select')).toHaveCount(0);

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
  expect(JSON.parse(response.request().postData() ?? '{}')).toMatchObject({
    timeZoneId: 'Asia/Dubai',
    defaultCurrencyCode: 'AED',
    defaultCulture: 'en-LB',
  });
  expect(body.email).toBe(email);
  await expect(page.getByText('Check your email')).toBeVisible();
  await expect(page.getByText(`We queued a confirmation link for ${email}.`)).toBeVisible();

  // Signing in before confirming: a wrong password is just wrong, as for an email nobody has, so
  // the screen never says an account waits here to a stranger (BEB-4); the right one is told to confirm.
  await page.goto('/auth/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill('Not-The-Password-2026!');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('#sign-in-summary')).toHaveText('Email or password is incorrect.');
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

  // The coaching space keeps the zone and the currency picked at registration.
  await page.goto('/workspace');
  await expect(page.locator('[data-zone] strong')).toHaveText('Dubai, Asia');
  await expect(page.getByRole('radio', { name: 'Another' })).toBeChecked();
  await expect(page.getByLabel('Currency code')).toHaveValue('AED');
});
