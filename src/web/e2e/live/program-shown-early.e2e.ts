import type { Browser, Page } from '@playwright/test';
import { chooseDay, chooseOption, kitSelect } from '../kit-controls';
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
 * The next program early, live (critique B18, TRN-023), against PostgreSQL, the real antiforgery and
 * real payments. Karim sells a client created here a running plan and a paid renewal: "The client
 * sees it: Now" shows nothing while the renewal waits for its payment or is part paid, opens beside
 * the running program once it is paid in full, and starts nothing before its day. A client whose
 * first plan has not begun reads the program in place of "Training is not available".
 */
requireLive();

interface Product {
  offers: { id: string }[];
}
interface Enrollment {
  id: string;
}
interface Templates {
  items: {
    name: string;
    isArchived: boolean;
    versions: { isPublished: boolean; weekCount: number | string }[];
  }[];
}
interface ClientRead {
  isAllowed: boolean;
  accessReason: string;
  program: { id: string; phase: string } | null;
  nextProgram: { id: string; weeks: { sessions: { sessionId: string }[] }[] } | null;
}

/** Today in Beirut as yyyy-mm-dd, plus a day offset. */
function beirutDay(offset = 0): string {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Beirut' }).format(new Date());
  const date = new Date(`${today}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

/** The shortest published program, so a plan built around it stays short. */
async function shortestProgram(page: Page, tenantId: string) {
  const { body } = await api<Templates>(page, 'GET', '/api/training/templates', { tenantId });
  const programs = body.items
    .filter((item) => !item.isArchived)
    .flatMap((item) =>
      item.versions
        .filter((version) => version.isPublished)
        .slice(0, 1)
        .map((version) => ({ name: item.name, weeks: Number(version.weekCount) })),
    )
    .sort((a, b) => a.weeks - b.weeks);
  expect(programs.length).toBeGreaterThan(0);
  return programs[0];
}

/** A plan for sale of this many weeks and price, sold to the client from this day. */
async function sell(
  page: Page,
  tenantId: string,
  clientId: string,
  name: string,
  weeks: number,
  price: number,
  startDate: string,
): Promise<string> {
  const product = await api<Product>(page, 'POST', '/api/commercial/products', {
    tenantId,
    body: {
      name,
      initialOffer: {
        label: `${weeks} weeks`,
        durationCount: weeks,
        durationUnit: 'Week',
        priceAmount: price,
        priceCurrency: 'USD',
        features: [{ feature: 'Training', allowsConcurrentCoverage: false }],
      },
    },
  });
  expect(product.status).toBe(200);
  const sold = await api<Enrollment>(
    page,
    'POST',
    `/api/commercial/clients/${clientId}/enrollments`,
    {
      tenantId,
      body: { offerId: product.body.offers[0].id, startDate, idempotencyKey: crypto.randomUUID() },
    },
  );
  expect(sold.status).toBe(200);
  return sold.body.id;
}

async function pay(page: Page, tenantId: string, planId: string, amount: number): Promise<void> {
  const paid = await api(page, 'POST', `/api/commercial/enrollments/${planId}/payments`, {
    tenantId,
    body: {
      amount,
      currencyCode: 'USD',
      receivedOn: beirutDay(),
      method: 'Cash',
      reference: null,
      note: null,
      idempotencyKey: crypto.randomUUID(),
    },
  });
  expect(paid.status).toBe(200);
}

/** A client of Karim's, created through the real invitation and acceptance, on a phone. */
async function newClient(browser: Browser, coach: Page, tenantId: string, firstName: string) {
  const invited = await api<{ developmentActionUrl: string }>(coach, 'POST', '/api/invitations', {
    tenantId,
    body: {
      email: uniqueEmail('shown.early'),
      firstName,
      lastName: `Spec${Date.now().toString(36)}`,
      phoneNumber: null,
      birthDate: '1991-02-03',
      idempotencyKey: crypto.randomUUID(),
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
  await client.getByLabel('Display name').fill(`${firstName} Spec`);
  await client.getByLabel('Password', { exact: true }).fill('Shown-Early-2026!');
  await client.getByLabel('Confirm password').fill('Shown-Early-2026!');
  await acceptLegalDocuments(client);
  await client.getByRole('button', { name: 'Create account and join' }).click();
  await expect(client).toHaveURL(/\/profile/, { timeout: 30_000 });
  const id = (await api<{ id: string }>(client, 'GET', '/api/client-profile/me', { tenantId })).body
    .id;
  return { client, id, close: () => phone.close() };
}

/** Assign program from its sheet, the coach's maxes typed in; `plan` picks among several. */
async function assign(
  page: Page,
  clientId: string,
  program: { name: string; weeks: number },
  startDate: string,
  options: { plan?: string; now?: boolean } = {},
): Promise<void> {
  await page.goto(`/clients/${clientId}/training?action=assign`);
  const sheet = page.getByRole('dialog', { name: 'Assign program' });
  await expect(sheet).toBeVisible({ timeout: 20_000 });
  if (options.plan) {
    await kitSelect(sheet, 'Plan').locator('button.trigger').click();
    await sheet.locator('[role="option"]', { hasText: options.plan }).click();
  }
  await chooseOption(
    sheet,
    'Program',
    program.weeks === 1 ? `${program.name} · 1 week` : `${program.name} · ${program.weeks} weeks`,
  );
  await chooseDay(sheet, 'Start date', startDate);
  const sees = sheet.locator('.sees');
  await expect(sees).toContainText('Each shared week opens on its first day.');
  if (options.now) await sees.getByRole('radio', { name: 'Now' }).check();
  // A program of typed weights asks for no max, so wait for it to be read, not for a row.
  await expect(sheet.locator('app-skeleton')).toHaveCount(0);
  for (const row of await sheet.locator('.max').all()) {
    const open = await row
      .locator('details')
      .evaluate((details) => (details as HTMLDetailsElement).open);
    if (!open) await row.locator('summary').click();
    await row.getByRole('spinbutton').first().fill('100');
  }
  await sheet.getByRole('button', { name: 'Assign program' }).click();
  await expect(sheet).toBeHidden({ timeout: 20_000 });
}

const read = async (client: Page, tenantId: string) =>
  (await api<ClientRead>(client, 'GET', '/api/training/me/program', { tenantId })).body;

test('the next program opens beside the running one once its plan is paid in full', async ({
  browser,
  page,
}) => {
  test.setTimeout(300_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, ACCOUNTS.owner);
  const [{ tenantId }] = await memberships(page);
  const program = await shortestProgram(page, tenantId);
  const { client, id, close } = await newClient(browser, page, tenantId, 'Nora');

  const stamp = Date.now().toString(36);
  const firstDay = beirutDay(7 * program.weeks);
  await sell(page, tenantId, id, `Running ${stamp}`, program.weeks, 0, beirutDay());
  const next = await sell(page, tenantId, id, `Renewal ${stamp}`, program.weeks, 100, firstDay);

  await assign(page, id, program, beirutDay(), { plan: `Running ${stamp}` });

  // Now, under a plan waiting for payment: the sheet says what that means.
  await page.goto(`/clients/${id}/training?action=assign`);
  const sheet = page.getByRole('dialog', { name: 'Assign program' });
  await expect(sheet).toBeVisible({ timeout: 20_000 });
  await kitSelect(sheet, 'Plan').locator('button.trigger').click();
  await sheet.locator('[role="option"]', { hasText: `Renewal ${stamp}` }).click();
  await sheet.locator('.sees').getByRole('radio', { name: 'Now' }).check();
  await expect(sheet.locator('.sees')).toContainText(
    'Nora reads the shared weeks once the plan is paid. Each workout opens on its day.',
  );
  await sheet.getByRole('button', { name: 'Not now' }).click();
  await assign(page, id, program, firstDay, { plan: `Renewal ${stamp}`, now: true });

  await page.goto(`/clients/${id}/training`);
  await page.locator('.others .row', { hasText: program.name }).click();
  await expect(page.locator('.hero .facts')).toContainText(
    'Nora reads it once a paid plan covers its dates',
  );

  // Nothing on the client's side while it waits, or while it is part paid.
  await client.goto('/training/program');
  await expect(client.getByRole('heading', { name: 'Training', level: 1 })).toBeVisible();
  await expect(client.locator('.hero')).toContainText('Week 1');
  await expect(client.getByRole('heading', { name: 'Next program' })).toHaveCount(0);
  expect((await read(client, tenantId)).nextProgram).toBeNull();
  await pay(page, tenantId, next, 40);
  expect((await read(client, tenantId)).nextProgram).toBeNull();

  // Paid in full it opens, read week by week, and nothing in it can be started.
  await pay(page, tenantId, next, 60);
  await client.reload();
  const section = client.locator('section[aria-labelledby="next-program-heading"]');
  await expect(section.getByRole('heading', { name: 'Next program' })).toBeVisible({
    timeout: 20_000,
  });
  await expect(section.locator('.block-dates')).toContainText(program.name);
  await section.locator('button.week-row').first().click();
  await expect(section.locator('.session').first()).toBeVisible();
  await expect(section.locator('a, .do-now')).toHaveCount(0);

  const shown = (await read(client, tenantId)).nextProgram!;
  const session = shown.weeks[0].sessions[0].sessionId;
  const early = await api<{ code: string }>(
    client,
    'POST',
    `/api/training/me/sessions/${session}/start`,
    {
      tenantId,
    },
  );
  expect([early.status, early.body.code]).toEqual([409, 'session_not_due']);

  // The coach reads what the client reads, and can keep it for its first day again.
  await page.reload();
  await page.locator('.others .row', { hasText: program.name }).click();
  await expect(page.locator('.hero .facts')).toContainText('Nora reads its shared weeks now');
  await page.getByRole('button', { name: 'Manage program' }).click();
  const item = page.locator('app-client-actions .item', { hasText: 'The client sees it' });
  await expect(item).toContainText('Now');
  await item.click();
  const dialog = page.getByRole('dialog', { name: 'The client sees it' });
  await dialog.getByRole('radio', { name: 'From its first day' }).check();
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'from its first day' })).toBeVisible({
    timeout: 20_000,
  });
  expect((await read(client, tenantId)).nextProgram).toBeNull();
  await close();
});

test('before a paid plan begins the client reads the program shown early in place of a closed page', async ({
  browser,
  page,
}) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, ACCOUNTS.owner);
  const [{ tenantId }] = await memberships(page);
  const program = await shortestProgram(page, tenantId);
  const { client, id, close } = await newClient(browser, page, tenantId, 'Dana');

  const firstDay = beirutDay(5);
  await sell(page, tenantId, id, `Booked ${Date.now().toString(36)}`, program.weeks, 0, firstDay);
  await assign(page, id, program, firstDay);

  await client.goto('/training/program');
  await expect(client.getByRole('heading', { name: 'Training is not available' })).toBeVisible({
    timeout: 20_000,
  });

  await page.goto(`/clients/${id}/training`);
  await page.getByRole('button', { name: 'Manage program' }).click();
  const item = page.locator('app-client-actions .item', { hasText: 'The client sees it' });
  await expect(item).toContainText('From its first day');
  await item.click();
  const dialog = page.getByRole('dialog', { name: 'The client sees it' });
  await dialog.getByRole('radio', { name: 'Now' }).check();
  await expect(dialog).toContainText('Dana reads the shared weeks now.');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('.hero .facts')).toContainText('Dana reads its shared weeks now', {
    timeout: 20_000,
  });

  await client.reload();
  await expect(client.locator('.hero .hero-eyebrow')).toContainText('Starts', { timeout: 20_000 });
  await expect(client.getByRole('heading', { name: 'Training is not available' })).toHaveCount(0);
  await expect(client.locator('.hero a.hero-action')).toHaveCount(0);
  await expect(client.getByRole('heading', { name: 'Finished workouts' })).toHaveCount(0);

  const view = await read(client, tenantId);
  expect([view.isAllowed, view.accessReason, view.program?.phase]).toEqual([
    false,
    'NotStarted',
    'Upcoming',
  ]);
  await close();
});
