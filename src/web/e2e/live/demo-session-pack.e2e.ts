import { ACCOUNTS, api, expect, memberships, requireLive, signIn, test } from './support';

/**
 * The demo's session pack, live (critique B17): a fresh demo gives the sessions screens something to
 * show. Maya has one 10-session pack, paid, beside her coaching plan, with four sessions held and the
 * last of them today, so Lea's Clients row and page for Maya, This month and the owner's By coach all
 * read it, and Maya reads what is left on Today and My plan, never a coach's note.
 */
requireLive();

interface Numbers {
  sessionsHeld: number;
  packsSold: number;
}
interface Report {
  thisMonth: Numbers;
  lastMonth: Numbers;
  coaches: { name: string; thisMonth: Numbers }[] | null;
}
interface Clients {
  clients: { client: { clientProfileId: string; firstName: string } }[];
}
interface Plans {
  plans: { name: string; lastDay: string; sessions: { count: number; left: number } | null }[];
}

/** "9 January", as the client's sentence says a day within the year. */
const longDay = (day: string) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'long' }).format(
    new Date(`${day}T12:00:00Z`),
  );

test('a fresh demo has a pack to show to Lea, the owner and Maya', async ({ browser, page }) => {
  test.setTimeout(180_000);
  await signIn(page, ACCOUNTS.coachLea);
  const [{ tenantId }] = await memberships(page);

  // Lea's Clients row, then her page for Maya, whose History keeps her own notes.
  const clients = await api<Clients>(page, 'GET', '/api/clients/overview', { tenantId });
  const mayaId = clients.body.clients.find((row) => row.client.firstName === 'Maya')?.client
    .clientProfileId;
  await page.goto('/clients');
  const row = page.locator('li.client-row').filter({ hasText: 'Maya Fakhoury' });
  await expect(row.locator('app-status-pill', { hasText: '6 sessions left' })).toBeVisible();
  await page.goto(`/clients/${mayaId}/service`);
  const pack = page.locator('.pack').filter({ hasText: 'Personal Training' });
  await expect(pack).toContainText('6 of 10 left');
  await pack.locator('summary').click();
  await expect(pack.locator('.ledger-detail').filter({ hasText: 'bar path' })).toBeVisible();

  // Her month has the session held today, and the rest are this month or last, whenever this runs.
  const month = (await api<Report>(page, 'GET', '/api/coach-month', { tenantId })).body;
  expect(month.thisMonth.sessionsHeld).toBeGreaterThanOrEqual(1);
  expect(month.thisMonth.sessionsHeld + month.lastMonth.sessionsHeld).toBeGreaterThanOrEqual(4);
  expect(month.thisMonth.packsSold + month.lastMonth.packsSold).toBeGreaterThanOrEqual(1);
  await page.goto('/');
  await expect(
    page.locator('.month-part').filter({ hasText: '1-on-1 sessions held' }).locator('.month-value'),
  ).toHaveText(String(month.thisMonth.sessionsHeld));
  await page.getByRole('link', { name: 'See this month and last' }).click();
  await expect(page.locator('[data-count="sessions"] .part-value')).toHaveText(
    String(month.thisMonth.sessionsHeld),
  );

  // The owner reads the same of Lea, on By coach, and sells the pack on Products.
  const origin = new URL(page.url()).origin;
  const desk = await browser.newContext({ baseURL: origin, timezoneId: 'Asia/Beirut' });
  const owner = await desk.newPage();
  await signIn(owner, ACCOUNTS.owner);
  const report = (await api<Report>(owner, 'GET', '/api/coach-month', { tenantId })).body;
  expect(report.coaches?.find((line) => line.name === 'Lea Khoury')?.thisMonth).toEqual(
    month.thisMonth,
  );
  await owner.goto('/month');
  await expect(
    owner.getByRole('table', { name: 'By coach' }).getByRole('row', { name: /Lea Khoury/ }),
  ).toContainText(String(month.thisMonth.sessionsHeld));
  await owner.goto('/products');
  await expect(owner.getByText('Personal Training', { exact: true })).toBeVisible();
  await desk.close();

  // Maya, on her phone: what is left on Today, one tap from My plan, and nothing a coach wrote.
  const phone = await browser.newContext({
    baseURL: origin,
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    timezoneId: 'Asia/Beirut',
    locale: 'en-US',
  });
  const client = await phone.newPage();
  await signIn(client, ACCOUNTS.maya);
  const plans = await api<Plans>(client, 'GET', '/api/client-plan/me', { tenantId });
  const lastDay = plans.body.plans.find((plan) => plan.sessions)?.lastDay ?? '';
  const sentence = `6 of 10 sessions with Lea left, until ${longDay(lastDay)}`;
  await client.goto('/');
  const today = client.getByRole('link', { name: /1-on-1 sessions/ });
  await expect(today).toContainText(sentence);
  await today.click();
  await expect(client).toHaveURL(/\/plan$/);
  const onPlan = client.locator('section.plan').filter({ hasText: 'Personal Training' });
  await expect(onPlan.locator('.plan-sessions')).toHaveText(sentence);
  await expect(onPlan.locator('.sessions li')).toHaveCount(4);
  await expect(onPlan).not.toContainText('bar path');
  await phone.close();
});
