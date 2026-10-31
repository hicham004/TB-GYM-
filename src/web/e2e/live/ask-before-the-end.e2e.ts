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
 * Ask to renew before the end, live (critique B14, SUB-014), against PostgreSQL and the real
 * antiforgery, tenancy and notices. A two-day plan is in its last days from its first, so Lea sells
 * one to a client created here: the client asks from My plan with the sentence the row gives, Today
 * says the same answer, a second request is the first, Lea hears of it by name, and the plan's own
 * notice opens where the row says.
 */
requireLive();

interface Product {
  offers: { id: string }[];
}
interface Enrollment {
  id: string;
}
interface Renewal {
  planEnded: boolean;
  endsOn: string | null;
  planId: string | null;
  canAsk: boolean;
  lastRequest: { id: string } | null;
}
interface Notices {
  items: { kind: string; title: string; body: string }[];
}

/** Today in Beirut as yyyy-mm-dd, plus a day offset. */
function beirutDay(offset = 0): string {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Beirut' }).format(new Date());
  const date = new Date(`${today}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
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

test('a client asks to renew in the last days of a plan, on My plan and on Today', async ({
  browser,
  page,
}) => {
  test.setTimeout(240_000);
  await signIn(page, ACCOUNTS.coachLea);
  const [{ tenantId }] = await memberships(page);

  // A client of Lea's, created through the real invitation and acceptance.
  const stamp = Date.now().toString(36);
  const invited = await api<{ developmentActionUrl: string }>(page, 'POST', '/api/invitations', {
    tenantId,
    body: {
      email: uniqueEmail('asker.spec'),
      firstName: 'Asker',
      lastName: `Spec${stamp}`,
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
  await client.getByLabel('Display name').fill('Asker Spec');
  await client.getByLabel('Password', { exact: true }).fill('Asker-Spec-2026!');
  await client.getByLabel('Confirm password').fill('Asker-Spec-2026!');
  await acceptLegalDocuments(client);
  await client.getByRole('button', { name: 'Create account and join' }).click();
  await expect(client).toHaveURL(/\/profile/, { timeout: 30_000 });
  const clientProfileId = (
    await api<{ id: string }>(client, 'GET', '/api/client-profile/me', { tenantId })
  ).body.id;

  // Nothing to ask about yet.
  expect(
    (await api<Renewal>(client, 'GET', '/api/client-renewal/me', { tenantId })).body.canAsk,
  ).toBe(false);

  // Two days, free, so it runs today and today is already within its last three.
  const product = await api<Product>(page, 'POST', '/api/commercial/products', {
    tenantId,
    body: {
      name: `Two days ${stamp}`,
      initialOffer: {
        label: '2 days',
        durationCount: 2,
        durationUnit: 'Day',
        priceAmount: 0,
        priceCurrency: 'USD',
        features: [{ feature: 'Training', allowsConcurrentCoverage: false }],
      },
    },
  });
  expect(product.status).toBe(200);
  const sold = await api<Enrollment>(
    page,
    'POST',
    `/api/commercial/clients/${clientProfileId}/enrollments`,
    {
      tenantId,
      body: {
        offerId: product.body.offers[0].id,
        startDate: beirutDay(),
        idempotencyKey: crypto.randomUUID(),
      },
    },
  );
  expect(sold.status).toBe(200);
  const lastDay = beirutDay(1);

  // The server says which plan and which day; a plan that has not ended.
  const status = (await api<Renewal>(client, 'GET', '/api/client-renewal/me', { tenantId })).body;
  expect(status).toMatchObject({
    planEnded: false,
    endsOn: lastDay,
    planId: sold.body.id,
    canAsk: true,
  });

  // My plan: the sentence and the button on the plan, in the client's own session.
  await client.goto('/plan');
  const plan = client.locator('section.plan');
  await expect(plan.locator('.plan-note')).toContainText(
    `Your coaching plan with Lea ends on ${pretty(lastDay)}.`,
  );
  await expect(plan.getByRole('link', { name: 'Go to Today' })).toHaveCount(0);
  await plan.getByRole('button', { name: 'Ask to renew' }).click();
  await expect(plan.getByRole('status')).toContainText(
    `Renewal request sent on ${pretty(beirutDay())}.`,
  );
  await expect(plan.getByRole('status')).toContainText(
    `You can ask again from ${pretty(beirutDay(7))}.`,
  );
  await expect(plan.getByRole('button', { name: 'Ask to renew' })).toHaveCount(0);

  // Today says the same, the same request, and a second one answers with the first.
  await client.goto('/');
  await expect(client.locator('#today-renewal-heading')).toContainText(
    `ends on ${pretty(lastDay)}.`,
  );
  await expect(client.locator('app-today-renewal [role="status"]')).toContainText(
    'Renewal request sent on',
  );
  await expect(client.getByRole('button', { name: 'Ask to renew' })).toHaveCount(0);
  const first = (await api<Renewal>(client, 'GET', '/api/client-renewal/me', { tenantId })).body;
  const again = await api<Renewal>(client, 'POST', '/api/client-renewal/me/requests', { tenantId });
  expect(again.status).toBe(200);
  expect(again.body.lastRequest?.id).toBe(first.lastRequest?.id);

  // Lea hears of it by name, in words that are true while the plan still runs.
  await expect
    .poll(
      async () =>
        (await api<Notices>(page, 'GET', '/api/notifications', { tenantId })).body.items.find(
          (item) => item.kind === 'RenewalRequested' && item.title.includes(`Spec${stamp}`),
        )?.body,
      { timeout: 60_000, intervals: [2_000] },
    )
    .toBe("Open the client's page to set up a renewal.");

  // The plan's own notice stays on Today, as its words say.
  await expect
    .poll(
      async () =>
        (await api<Notices>(client, 'GET', '/api/notifications', { tenantId })).body.items.some(
          (item) => item.kind === 'EnrollmentActivated',
        ),
      { timeout: 60_000, intervals: [2_000] },
    )
    .toBe(true);
  await client.goto('/notifications');
  await expect(client.getByRole('link', { name: /Your plan has started/ })).toHaveAttribute(
    'href',
    '/',
  );
  await phone.close();
});
