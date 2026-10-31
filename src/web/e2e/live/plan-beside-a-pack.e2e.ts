import { ACCOUNTS, api, expect, memberships, requireLive, signIn, test } from './support';

/**
 * A plan that ends beside a pack, live (critique B13, SES-010), against PostgreSQL and the real
 * antiforgery and tenancy. A plan cannot be sold already over, so this starts from the demo's Elie,
 * whose coaching plan ran out days ago and who has asked to renew: Karim sells him a pack, and Clients,
 * Today, Service & access and Elie's own Today all go on reading the plan as ended, Renew offers it,
 * and the pack takes a session as it would anywhere.
 */
requireLive();

interface Product {
  offers: { id: string }[];
}
interface Ended {
  client: { clientProfileId: string; firstName: string };
  enrollmentId: string;
  planName: string;
  lastDay: string;
}
interface Today {
  today: string;
  plansEndedNotRenewed: Ended[];
  month: { activeClientCount: number };
}
interface Clients {
  clients: { client: { clientProfileId: string }; featuresToday: string[] }[];
}
interface Renewal {
  planEnded: boolean;
  endedOn: string;
  coachName: string;
  lastRequest: { id: string } | null;
}
interface Commercial {
  featureAccess: { feature: string; reason: string }[];
}

const pretty = (day: string) =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  })
    .format(new Date(`${day}T12:00:00Z`))
    .replace(',', '');

test('a coaching plan that ran out reads as ended beside a running pack', async ({
  browser,
  page,
}) => {
  test.setTimeout(240_000);
  await signIn(page, ACCOUNTS.owner);
  const [{ tenantId }] = await memberships(page);
  const before = (await api<Today>(page, 'GET', '/api/coach-today', { tenantId })).body;
  const ended = before.plansEndedNotRenewed.find((row) => row.client.firstName === 'Elie');
  expect(ended, 'the demo has Elie under Ended, not renewed').toBeTruthy();
  const clientId = ended!.client.clientProfileId;

  // A free pack of its own, named for this run.
  const packName = `Personal training ${Date.now().toString(36)}`;
  const product = await api<Product>(page, 'POST', '/api/commercial/products', {
    tenantId,
    body: {
      name: packName,
      kind: 'SessionPack',
      initialOffer: {
        label: '4 sessions',
        durationCount: 60,
        durationUnit: 'Day',
        priceAmount: 0,
        priceCurrency: 'USD',
        features: [],
        sessionCount: 4,
      },
    },
  });
  expect(product.status).toBe(200);
  const sold = await api(page, 'POST', `/api/commercial/clients/${clientId}/enrollments`, {
    tenantId,
    body: {
      offerId: product.body.offers[0].id,
      startDate: before.today,
      idempotencyKey: crypto.randomUUID(),
    },
  });
  expect(sold.status).toBe(200);

  // The server's answers: still under Ended, not renewed, naming the coaching plan, and counted as active.
  const after = (await api<Today>(page, 'GET', '/api/coach-today', { tenantId })).body;
  const listed = after.plansEndedNotRenewed.find((row) => row.client.clientProfileId === clientId);
  expect(listed).toMatchObject({ enrollmentId: ended!.enrollmentId, planName: ended!.planName });
  const clients = (await api<Clients>(page, 'GET', '/api/clients/overview', { tenantId })).body;
  expect(after.month.activeClientCount).toBe(
    clients.clients.filter((item) => item.featuresToday.length > 0).length,
  );
  expect(
    clients.clients.find((item) => item.client.clientProfileId === clientId)?.featuresToday,
  ).toEqual(['Sessions']);

  // Clients says the plan is not running, with the sessions beside it, never On track.
  await page.goto('/clients');
  const row = page
    .locator('li.client-row')
    .filter({ has: page.getByRole('link', { name: 'Elie Azar' }) });
  await expect(row).toContainText('No active plan');
  await expect(row).toContainText(/\d+ sessions left/);
  await expect(row.locator('.plan-name')).toHaveText(ended!.planName);
  await expect(row.locator('.plan-end')).toHaveText(`Ended ${pretty(ended!.lastDay)}`);
  await expect(row).not.toContainText('On track');

  // Today's Renew opens Service & access on the plan that ended, not on the pack.
  await page.goto('/');
  const line = page.locator('.plan-list .plan-row').filter({ hasText: 'Elie Azar' });
  await expect(line).toContainText(ended!.planName);
  await line.getByRole('link', { name: /^Renew/ }).click();
  await expect(page).toHaveURL(new RegExp(`/clients/${clientId}/service`));
  const sheet = page.getByRole('dialog', { name: 'Renew plan' });
  await expect(sheet).toContainText(ended!.planName);
  await expect(sheet).not.toContainText(packName);
  await sheet.getByRole('button', { name: 'Not now' }).click();
  await expect(page.locator('#plan-title')).toHaveText(ended!.planName);
  await expect(page.locator('.eyebrow')).toHaveText(`Ended ${pretty(ended!.lastDay)}`);
  await expect(page.locator('.pack-name').filter({ hasText: packName })).toBeVisible();

  // The pack changes in nothing: it takes a session, and Messaging stays closed with the plan.
  const session = await api(page, 'POST', `/api/commercial/clients/${clientId}/sessions`, {
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
  expect(session.status).toBe(200);
  const reasons = (
    await api<Commercial>(page, 'GET', `/api/commercial/clients/${clientId}`, { tenantId })
  ).body.featureAccess;
  expect(reasons.find((item) => item.feature === 'Messaging')?.reason).toBe('Expired');
  expect(reasons.find((item) => item.feature === 'Sessions')?.reason).toBe('Granted');

  // Elie reads the plan as ended, and the request stands: asking again answers with it, never "not ended".
  const context = await browser.newContext({ baseURL: new URL(page.url()).origin });
  const elie = await context.newPage();
  await signIn(elie, ACCOUNTS.elie);
  const status = (await api<Renewal>(elie, 'GET', '/api/client-renewal/me', { tenantId })).body;
  expect(status).toMatchObject({ planEnded: true, endedOn: ended!.lastDay });
  await expect(elie.locator('#today-renewal-heading')).toHaveText(
    `Your coaching plan with ${status.coachName} ended on ${pretty(ended!.lastDay)}.`,
  );
  const asked = await api<Renewal>(elie, 'POST', '/api/client-renewal/me/requests', { tenantId });
  expect(asked.status).toBe(200);
  expect(asked.body.lastRequest?.id).toBe(status.lastRequest?.id);
  await context.close();
});
