import {
  ACCOUNTS,
  acceptLegalDocuments,
  api,
  expect,
  memberships,
  requireLive,
  signIn,
  test,
  uniqueEmail,
} from './support';

/**
 * Sessions for clients and on Today, live (critique B10c, SES-007 and SES-008), against PostgreSQL and
 * the real antiforgery and tenancy: Lea sells a pack to a client created here and records its first
 * session with the money, the client reads what is left on Today and My plan, a charge reaches them
 * with its reason and a coach's note never does, and as the pack runs out the Clients row warms, Today
 * asks to renew it and This month counts what was held.
 */
requireLive();

interface Product {
  offers: { id: string }[];
}
interface Today {
  month: { sessionsHeld: number | null };
}

function uuid(): string {
  return crypto.randomUUID();
}

/** Today in Beirut as yyyy-mm-dd, plus a day offset. */
function beirutDay(offset = 0): string {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Beirut' }).format(new Date());
  const date = new Date(`${today}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

/** "29 December", as the client's sentence says a day within the year. */
function longDay(day: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'long',
  }).format(new Date(`${day}T12:00:00Z`));
}

test('a client reads what is left on their pack, and their coach sees it run out', async ({
  browser,
  page,
}) => {
  test.setTimeout(240_000);
  await signIn(page, ACCOUNTS.coachLea);
  const [{ tenantId }] = await memberships(page);
  const heldBefore =
    (await api<Today>(page, 'GET', '/api/coach-today', { tenantId })).body.month.sessionsHeld ?? 0;

  // A pack of four of its own and a client of Lea's, each named for this run, so it runs again.
  const stamp = Date.now().toString(36);
  const clientName = `Balance ${stamp}`;
  const product = await api<Product>(page, 'POST', '/api/commercial/products', {
    tenantId,
    body: {
      name: `Balance pack ${stamp}`,
      kind: 'SessionPack',
      initialOffer: {
        label: '4 sessions',
        durationCount: 60,
        durationUnit: 'Day',
        priceAmount: 120,
        priceCurrency: 'USD',
        features: [],
        sessionCount: 4,
      },
    },
  });
  expect(product.status).toBe(200);

  const email = uniqueEmail('balance.spec');
  const invited = await api<{ developmentActionUrl: string }>(page, 'POST', '/api/invitations', {
    tenantId,
    body: {
      email,
      firstName: 'Balance',
      lastName: stamp,
      phoneNumber: null,
      birthDate: '1991-02-03',
      idempotencyKey: uuid(),
    },
  });
  expect(invited.status).toBe(201);
  const phone = await browser.newContext({
    baseURL: new URL(invited.body.developmentActionUrl).origin,
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    timezoneId: 'Asia/Beirut',
    locale: 'en-US',
  });
  const client = await phone.newPage();
  await client.goto(invited.body.developmentActionUrl);
  await client.getByLabel('Display name').fill(clientName);
  await client.getByLabel('Password', { exact: true }).fill('Balance-Spec-2026!');
  await client.getByLabel('Confirm password').fill('Balance-Spec-2026!');
  await acceptLegalDocuments(client);
  await client.getByRole('button', { name: 'Create account and join' }).click();
  await expect(client).toHaveURL(/\/profile/, { timeout: 30_000 });
  const me = await api<{ id: string }>(client, 'GET', '/api/client-profile/me', { tenantId });
  const clientId = me.body.id;

  // Waiting for payment, the pack holds nothing yet, and Today says so.
  const sold = await api<{ id: string }>(
    page,
    'POST',
    `/api/commercial/clients/${clientId}/enrollments`,
    {
      tenantId,
      body: {
        offerId: product.body.offers[0].id,
        startDate: beirutDay(-3),
        idempotencyKey: uuid(),
      },
    },
  );
  expect(sold.status).toBe(200);
  const lastDay = longDay(beirutDay(56));
  await client.goto('/');
  const row = client.getByRole('link', { name: /1-on-1 sessions/ });
  await expect(row).toContainText('Waiting for payment');

  // The first session is recorded with its money in the same sheet.
  await page.goto(`/clients/${clientId}/service`);
  await page.getByRole('button', { name: 'Record a session' }).click();
  const sheet = page.getByRole('dialog', { name: 'Record a session' });
  await expect(sheet).toContainText('is waiting for USD 120');
  await sheet.getByRole('button', { name: 'Record session and payment' }).click();
  await expect(sheet).toBeHidden({ timeout: 30_000 });

  // The client reads what is left on Today, and My plan is one tap away.
  await client.reload();
  await expect(row).toContainText(`3 of 4 sessions with Lea left, until ${lastDay}`);
  await row.click();
  await expect(client).toHaveURL(/\/plan$/);
  const pack = client.locator('section.plan');
  await expect(pack.locator('.plan-sessions')).toHaveText(
    `3 of 4 sessions with Lea left, until ${lastDay}`,
  );
  await expect(pack.locator('.sessions li')).toHaveCount(1);

  // A session with a note for the team and a charge with a reason for the client.
  const record = (fields: object) =>
    api(page, 'POST', `/api/commercial/clients/${clientId}/sessions`, {
      tenantId,
      body: { day: beirutDay(), receipt: null, idempotencyKey: uuid(), ...fields },
    });
  expect((await record({ outcome: 'Held', note: 'Left knee still sore' })).status).toBe(200);
  expect((await record({ outcome: 'Charged', reason: 'No-show: you didn’t come' })).status).toBe(
    200,
  );

  await client.reload();
  await expect(pack.locator('.plan-sessions')).toHaveText(
    `1 of 4 sessions with Lea left, until ${lastDay}`,
  );
  await expect(pack.locator('.sessions li')).toHaveCount(3);
  await expect(pack).toContainText('No-show: you didn’t come');
  await expect(pack).not.toContainText('Left knee');
  const read = await api<unknown>(client, 'GET', '/api/client-plan/me', { tenantId });
  expect(JSON.stringify(read.body)).not.toContain('Left knee');

  // The client's row warms, and is no reason to need attention.
  await page.goto('/clients');
  const clientRow = page.locator('li.client-row').filter({ hasText: clientName });
  const chip = clientRow.locator('app-status-pill', { hasText: '1 session left' });
  await expect(chip).toBeVisible();
  await expect(chip).toHaveClass(/warm/);
  await expect(clientRow.locator('app-tag', { hasText: 'session' })).toHaveCount(0);

  // Today says so, renews this pack, and counts the two sessions held and not the charge.
  await page.goto('/');
  await expect(page.locator('li.need').filter({ hasText: clientName })).toContainText(
    `${clientName} has 1 session left`,
  );
  const held = page.locator('.month-part').filter({ hasText: '1-on-1 sessions held' });
  await expect(held.locator('.month-value')).toHaveText(String(heldBefore + 2));
  await page.getByRole('link', { name: `Renew pack for ${clientName}` }).click();
  await expect(page.getByRole('dialog', { name: 'Renew plan' })).toBeVisible();

  await phone.close();
});
