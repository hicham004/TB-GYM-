import {
  ACCOUNTS,
  api,
  expect,
  memberships,
  requireLive,
  signIn,
  test,
  uniqueEmail,
} from './support';
import { chooseDay } from '../kit-controls';

/**
 * Sell and get paid, live (full audit, October 2026), against PostgreSQL and the real antiforgery
 * and tenancy: Lea starts a plan for a client created here, a double tap makes one plan, a part
 * payment keeps access locked, retries and races make one receipt, overpayment, another currency and
 * a part of a cent are refused (audit BILL-1), a receipt is the day it was entered (WEA-6), the last
 * payment opens access at once, a clashing plan is refused with the plan's dates, and a price change
 * leaves the running plan's price alone (SUB-002, SUB-007, SUB-008, SUB-011).
 */
requireLive();

interface Offer {
  id: string;
  durationCount: number;
  priceAmount: number;
  priceCurrency: string;
  isActive: boolean;
  version: number;
}
interface Product {
  id: string;
  name: string;
  offers: Offer[];
}
interface Enrollment {
  id: string;
  effectiveStatus: string;
  priceAmount: number;
  paidAmount: number;
  balanceAmount: number;
  startDate: string;
  endDateExclusive: string;
}
interface Access {
  feature: string;
  isAllowed: boolean;
  reason: string;
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

function pretty(day: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(new Date(`${day}T12:00:00Z`));
}

test('a plan is sold, part paid, fully paid and protected against double taps and overpayment', async ({
  browser,
  page,
}) => {
  test.setTimeout(240_000);
  await signIn(page, ACCOUNTS.coachLea);
  const [{ tenantId }] = await memberships(page);

  // A client of Lea's, created through the real invitation and acceptance.
  const email = uniqueEmail('buyer.spec');
  const invited = await api<{ developmentActionUrl: string }>(page, 'POST', '/api/invitations', {
    tenantId,
    body: {
      email,
      firstName: 'Buyer',
      lastName: 'Spec',
      phoneNumber: null,
      birthDate: '1991-02-03',
      idempotencyKey: uuid(),
    },
  });
  expect(invited.status).toBe(201);
  const baseURL = new URL(invited.body.developmentActionUrl).origin;
  const phone = await browser.newContext({
    baseURL,
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    timezoneId: 'Asia/Beirut',
    locale: 'en-US',
  });
  const client = await phone.newPage();
  await client.goto(invited.body.developmentActionUrl);
  await client.getByLabel('Display name').fill('Buyer Spec');
  await client.getByLabel('Password', { exact: true }).fill('Buyer-Spec-2026!');
  await client.getByLabel('Confirm password').fill('Buyer-Spec-2026!');
  await client.getByRole('button', { name: 'Create account and join' }).click();
  await expect(client).toHaveURL(/\/profile/, { timeout: 30_000 });
  const me = await api<{ id: string }>(client, 'GET', '/api/client-profile/me', { tenantId });
  const clientId = me.body.id;
  const access = async () =>
    (await api<Access[]>(client, 'GET', '/api/client-access/me', { tenantId })).body;
  const reasons = async () => [
    ...new Set(
      (await access())
        .filter((item) => item.feature !== 'ResourceLibrary')
        .map((item) => (item.isAllowed ? 'ok' : item.reason)),
    ),
  ];

  // The 4-week option of Online Coaching, whatever its current price.
  const catalog = await api<{ products: Product[] }>(page, 'GET', '/api/commercial/products', {
    tenantId,
  });
  const online = catalog.body.products.find((product) => product.name === 'Online Coaching')!;
  const fourWeeks = online.offers.find((offer) => offer.isActive && offer.durationCount === 4)!;
  const price = fourWeeks.priceAmount;

  // Start a plan from Service & access; a double tap on Start plan makes one plan.
  await page.goto(`/clients/${clientId}/service`);
  await page.getByRole('button', { name: 'Start a plan' }).first().click();
  const start = page.getByRole('dialog');
  await expect(start.locator('label.choice')).toHaveCount(
    online.offers.filter((o) => o.isActive).length +
      catalog.body.products
        .filter((p) => p.name !== 'Online Coaching')
        .flatMap((p) => p.offers)
        .filter((o) => o.isActive).length,
  );
  await start.locator('label.choice', { hasText: 'Online Coaching · 4 weeks' }).click();
  await chooseDay(start, 'First day', beirutDay());
  const lastDay = beirutDay(27);
  await expect(start.locator('.run')).toHaveText(
    `Runs ${pretty(beirutDay())} – ${pretty(lastDay)}`,
  );
  await start.getByRole('button', { name: 'Start plan' }).evaluate((button: HTMLButtonElement) => {
    button.click();
    button.click();
  });
  await expect(page.getByText('Online Coaching is set up for Buyer.')).toBeVisible();
  const plans = await api<Enrollment[]>(page, 'GET', `/api/commercial/clients/${clientId}`, {
    tenantId,
  });
  const list = Array.isArray(plans.body)
    ? plans.body
    : (plans.body as unknown as { enrollments: Enrollment[] }).enrollments;
  expect(list).toHaveLength(1);
  const plan = list[0];
  expect(plan.effectiveStatus).toBe('PendingPayment');
  expect(plan.endDateExclusive).toBe(beirutDay(28));
  await expect(page.locator('.hero app-status-pill')).toHaveText('Waiting for payment');
  expect(await reasons()).toEqual(['PaymentRequired']);
  await client.goto('/');
  await expect(
    client.getByText('Contact your coach to activate your coaching plan.'),
  ).toBeVisible();

  // A part payment, double-tapped: one receipt, access still locked.
  await page.locator('.hero-actions > button', { hasText: 'Record payment' }).click();
  const pay = page.getByRole('dialog', { name: 'Record payment' });
  await expect(pay.getByLabel('Amount received')).toHaveValue(String(price));
  await pay.getByLabel('Amount received').fill('80');
  await expect(
    pay.getByText(
      `USD ${price - 80} will still be left. Buyer gets access once the full price is paid.`,
    ),
  ).toBeVisible();
  await pay
    .getByRole('button', { name: 'Record payment' })
    .evaluate((button: HTMLButtonElement) => {
      button.click();
      button.click();
    });
  await expect(page.getByText('The payment is recorded.')).toBeVisible();
  await expect(page.locator('.payment-amount')).toHaveText(['USD 80']);
  // The day the coach chose, as the server dated it in the workspace's zone (WEA-6).
  await expect(page.locator('.payment-date')).toHaveText([
    `${pretty(beirutDay())} ${beirutDay().slice(0, 4)}`,
  ]);
  await expect(page.locator('.hero app-status-pill')).toHaveText('Waiting for payment');
  expect(await reasons()).toEqual(['PaymentRequired']);

  // The same payment twice at once (one key): one receipt. Two keys at once past the balance: one refused.
  const paymentsPath = `/api/commercial/enrollments/${plan.id}/payments`;
  const receipt = (amount: number, key: string, reference: string) => ({
    amount,
    currencyCode: 'USD',
    receivedOn: beirutDay(),
    method: 'Cash',
    reference,
    note: null,
    idempotencyKey: key,
  });
  const sameKey = uuid();
  const twice = await page.evaluate(
    async ({ path, bodies, tenantId }) => {
      const csrf = await fetch('/api/auth/csrf', { credentials: 'same-origin' });
      const token = ((await csrf.json()) as { token: string }).token;
      return Promise.all(
        bodies.map(async (body) => {
          const response = await fetch(path, {
            method: 'POST',
            credentials: 'same-origin',
            headers: {
              'Content-Type': 'application/json',
              'X-XSRF-TOKEN': token,
              'X-Tenant-Id': tenantId,
            },
            body: JSON.stringify(body),
          });
          return {
            status: response.status,
            body: (await response.json().catch(() => null)) as Enrollment | null,
          };
        }),
      );
    },
    {
      path: paymentsPath,
      bodies: [receipt(20, sameKey, 'SAME'), receipt(20, sameKey, 'SAME')],
      tenantId,
    },
  );
  expect(twice.map((r) => r.status)).toEqual([200, 200]);
  expect(twice[0].body?.paidAmount).toBe(100);
  expect(twice[1].body?.paidAmount).toBe(100);
  const left = price - 100;
  const race = await page.evaluate(
    async ({ path, bodies, tenantId }) => {
      const csrf = await fetch('/api/auth/csrf', { credentials: 'same-origin' });
      const token = ((await csrf.json()) as { token: string }).token;
      return Promise.all(
        bodies.map(async (body) => {
          const response = await fetch(path, {
            method: 'POST',
            credentials: 'same-origin',
            headers: {
              'Content-Type': 'application/json',
              'X-XSRF-TOKEN': token,
              'X-Tenant-Id': tenantId,
            },
            body: JSON.stringify(body),
          });
          return response.status;
        }),
      );
    },
    {
      path: paymentsPath,
      bodies: [receipt(left - 5, uuid(), 'RACE-A'), receipt(left - 5, uuid(), 'RACE-B')],
      tenantId,
    },
  );
  expect(race.sort()).toEqual([200, 400]);

  // Overpayment, another currency and a future date are refused.
  const over = await api<{ errors: Record<string, string[]> }>(page, 'POST', paymentsPath, {
    tenantId,
    body: receipt(100, uuid(), 'OVER'),
  });
  expect(over.status).toBe(400);
  expect(over.body.errors['amount'][0]).toBe(
    'The payment cannot exceed the outstanding enrollment balance.',
  );
  const lbp = await api<{ errors: Record<string, string[]> }>(page, 'POST', paymentsPath, {
    tenantId,
    body: { ...receipt(5, uuid(), 'LBP'), currencyCode: 'LBP' },
  });
  expect(lbp.status).toBe(400);
  expect(Object.keys(lbp.body.errors)).toContain('currencyCode');
  const future = await api<{ errors: Record<string, string[]> }>(page, 'POST', paymentsPath, {
    tenantId,
    body: { ...receipt(5, uuid(), 'FUTURE'), receivedOn: beirutDay(3) },
  });
  expect(future.status).toBe(400);
  expect(future.body.errors['receivedOn'][0]).toBe("A payment can't be received in the future.");

  // A part of a cent is refused, never rounded into the ledger (BILL-1); nothing is recorded.
  for (const amount of [1.005, 4.995]) {
    const subCent = await api<{ errors: Record<string, string[]> }>(page, 'POST', paymentsPath, {
      tenantId,
      body: receipt(amount, uuid(), 'SUB-CENT'),
    });
    expect(subCent.status).toBe(400);
    expect(subCent.body.errors['amount'][0]).toBe('Use at most two decimals.');
  }
  const priceCents = await api<{ errors: Record<string, string[]> }>(
    page,
    'POST',
    `/api/commercial/offers/${fourWeeks.id}/price-changes`,
    {
      tenantId,
      body: { priceAmount: price + 0.125, version: fourWeeks.version, idempotencyKey: uuid() },
    },
  );
  expect(priceCents.status).toBe(400);
  expect(priceCents.body.errors['priceAmount'][0]).toBe('Use at most two decimals.');

  // The rest from the sheet: access opens at once.
  await page.reload();
  await page.locator('.hero-actions > button', { hasText: 'Record payment' }).click();
  const rest = page.getByRole('dialog', { name: 'Record payment' });
  await expect(rest.getByLabel('Amount received')).toHaveValue('5');
  await rest.getByLabel('Amount received').fill('4.995');
  await rest.getByRole('button', { name: 'Record payment' }).click();
  await expect(rest.getByText('Use at most two decimals.')).toBeVisible();
  await rest.getByLabel('Amount received').fill('105');
  await rest.getByRole('button', { name: 'Record payment' }).click();
  await expect(rest.getByText('That is more than is left to pay.')).toBeVisible();
  await rest.getByLabel('Amount received').fill('5');
  await expect(
    rest.getByText('This pays the plan in full, so Buyer gets access right away.'),
  ).toBeVisible();
  await rest.getByRole('button', { name: 'Record payment' }).click();
  await expect(page.getByText('The payment is recorded.')).toBeVisible();
  await expect(page.locator('.hero app-status-pill')).toHaveText('Active · 27 days left');
  await expect(page.locator('.panel-span').first()).toHaveText('Paid in full');
  expect(await reasons()).toEqual(['ok']);
  await client.goto('/');
  await expect(client.getByText('Nothing assigned yet')).toBeVisible();

  // A clashing plan is warned about and refused with the plan's own dates.
  await page.getByRole('button', { name: 'Manage plan' }).click();
  await page.locator('.hero-actions button.item', { hasText: 'Start another plan' }).click();
  const clash = page.getByRole('dialog');
  await clash.locator('label.choice', { hasText: 'Online Coaching · 12 weeks' }).click();
  await chooseDay(clash, 'First day', beirutDay());
  const clashText = `Buyer already has Online Coaching from ${pretty(beirutDay())} 2026 to ${pretty(lastDay)} 2026. Start on ${pretty(beirutDay(28))} 2026 or later`;
  await expect(clash.locator('.warn-text')).toContainText(clashText);
  await clash.getByRole('button', { name: 'Start plan' }).click();
  await expect(clash.getByRole('alert')).toContainText(clashText);
  await clash.getByRole('button', { name: 'Not now' }).click();
  await page
    .getByRole('dialog')
    .last()
    .getByRole('button', { name: 'Close', exact: true })
    .last()
    .click();

  // A price change on the option leaves this plan's price alone; the catalog's clients stay counted.
  const fresh = await api<{ products: Product[] }>(page, 'GET', '/api/commercial/products', {
    tenantId,
  });
  const current = fresh.body.products
    .find((product) => product.name === 'Online Coaching')!
    .offers.find((offer) => offer.isActive && offer.durationCount === 4)!;
  const changed = await api<{ offers: Offer[] }>(
    page,
    'POST',
    `/api/commercial/offers/${current.id}/price-changes`,
    {
      tenantId,
      body: {
        priceAmount: current.priceAmount + 10,
        version: current.version,
        idempotencyKey: uuid(),
      },
    },
  );
  expect(changed.status).toBeLessThan(300);
  const after = await api<Enrollment[] | { enrollments: Enrollment[] }>(
    page,
    'GET',
    `/api/commercial/clients/${clientId}`,
    { tenantId },
  );
  const kept = (Array.isArray(after.body) ? after.body : after.body.enrollments).find(
    (item) => item.id === plan.id,
  )!;
  expect(kept.priceAmount).toBe(price);
  await page.reload();
  await expect(page.locator('.hero .facts li', { hasText: `USD ${price}` })).toBeVisible();
  await phone.close();
});
