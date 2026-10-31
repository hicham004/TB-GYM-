import { ACCOUNTS, api, expect, memberships, requireLive, signIn, test } from './support';

/**
 * This month, live (critique B10d, SUB-018), against PostgreSQL and the real antiforgery and tenancy:
 * Lea sells a pack, takes the money and holds a session; her page counts them from Today's link, the
 * owner's row for her says the same as she reads, and a coach's page has nobody else's numbers.
 */
requireLive();

interface Numbers {
  moneyReceived: { currency: string; amount: number; paymentCount: number }[];
  sessionsHeld: number;
  plansSold: number;
  packsSold: number;
  clientsStarted: number;
  clientsEnded: number;
}
interface Report {
  today: string;
  thisMonth: Numbers;
  coaches: { name: string; thisMonth: Numbers }[] | null;
}
interface Product {
  offers: { id: string }[];
}
interface ClientList {
  clients: { client: { clientProfileId: string } }[];
}

const dollars = (numbers: Numbers) =>
  Number(numbers.moneyReceived.find((line) => line.currency === 'USD')?.amount ?? 0);

test('a coach reads the month they sold into, and the owner reads the same of them', async ({
  browser,
  page,
}) => {
  test.setTimeout(180_000);
  await signIn(page, ACCOUNTS.coachLea);
  const [{ tenantId }] = await memberships(page);
  const before = (await api<Report>(page, 'GET', '/api/coach-month', { tenantId })).body;
  expect(before.coaches).toBeNull();

  const stamp = Date.now().toString(36);
  const product = await api<Product>(page, 'POST', '/api/commercial/products', {
    tenantId,
    body: {
      name: `Month pack ${stamp}`,
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
  const clients = await api<ClientList>(page, 'GET', '/api/clients/overview', { tenantId });
  const clientId = clients.body.clients[0].client.clientProfileId;

  const sold = await api<{ id: string }>(
    page,
    'POST',
    `/api/commercial/clients/${clientId}/enrollments`,
    {
      tenantId,
      body: {
        offerId: product.body.offers[0].id,
        startDate: before.today,
        idempotencyKey: crypto.randomUUID(),
      },
    },
  );
  expect(sold.status).toBe(200);
  const paid = await api(page, 'POST', `/api/commercial/enrollments/${sold.body.id}/payments`, {
    tenantId,
    body: {
      amount: 120,
      currencyCode: 'USD',
      receivedOn: before.today,
      method: 'Cash',
      reference: null,
      note: null,
      idempotencyKey: crypto.randomUUID(),
    },
  });
  expect(paid.status).toBe(200);
  const held = await api(page, 'POST', `/api/commercial/clients/${clientId}/sessions`, {
    tenantId,
    body: {
      outcome: 'Held',
      day: before.today,
      note: null,
      reason: null,
      receipt: null,
      idempotencyKey: crypto.randomUUID(),
    },
  });
  expect(held.status).toBe(200);

  const after = (await api<Report>(page, 'GET', '/api/coach-month', { tenantId })).body;
  expect(after.thisMonth.packsSold).toBe(before.thisMonth.packsSold + 1);
  expect(after.thisMonth.sessionsHeld).toBe(before.thisMonth.sessionsHeld + 1);
  expect(dollars(after.thisMonth)).toBe(dollars(before.thisMonth) + 120);

  // From Today's This month, to the page, which says what the server counted.
  await page.goto('/');
  await page.getByRole('link', { name: 'See this month and last' }).click();
  await expect(page).toHaveURL(/\/month$/);
  await expect(page.getByRole('heading', { level: 2, name: 'Your numbers' })).toBeVisible();
  await expect(page.locator('[data-count="sessions"] .part-value')).toHaveText(
    String(after.thisMonth.sessionsHeld),
  );
  await expect(page.locator('[data-count="packs"] .part-value')).toHaveText(
    String(after.thisMonth.packsSold),
  );
  await expect(page.locator('.money-line').filter({ hasText: 'USD' })).toContainText(
    dollars(after.thisMonth).toLocaleString('en-US'),
  );
  await expect(page.getByRole('table')).toHaveCount(0);

  // The owner reads the same of her, on a row of their own page.
  const context = await browser.newContext({ baseURL: page.url().replace(/\/month$/, '') });
  const owner = await context.newPage();
  await signIn(owner, ACCOUNTS.owner);
  const report = (await api<Report>(owner, 'GET', '/api/coach-month', { tenantId })).body;
  expect(report.coaches?.find((row) => row.name === 'Lea Khoury')?.thisMonth).toEqual(
    after.thisMonth,
  );
  await owner.goto('/month');
  const row = owner.getByRole('table', { name: 'By coach' }).getByRole('row', {
    name: /Lea Khoury/,
  });
  await expect(row).toContainText(dollars(after.thisMonth).toLocaleString('en-US'));
  await context.close();
});
