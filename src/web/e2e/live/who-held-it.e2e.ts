import { kitSelect } from '../kit-controls';
import { ACCOUNTS, api, expect, memberships, requireLive, signIn, test } from './support';

/**
 * Who held a session, live (critique B12, SES-003 and SES-008), against PostgreSQL and the real
 * antiforgery and tenancy: Karim, the owner, records a session Omar held for Lea's client and picks him
 * under Who held it; the pack's History keeps both people, each coach's month counts what they held,
 * Lea has no box and is refused another name, and the client reads neither of them.
 */
requireLive();

interface Product {
  offers: { id: string }[];
}
interface Numbers {
  sessionsHeld: number;
}
interface Report {
  today: string;
  thisMonth: Numbers;
  coaches: { coachUserId: string; name: string; thisMonth: Numbers }[] | null;
}

const heldBy = (report: Report, name: string) =>
  report.coaches?.find((row) => row.name === name)?.thisMonth.sessionsHeld ?? 0;

test('the gym owner says who held a session, and a coach logs only their own', async ({
  browser,
  page,
}) => {
  test.setTimeout(240_000);
  await signIn(page, ACCOUNTS.owner);
  const [{ tenantId }] = await memberships(page);
  const before = (await api<Report>(page, 'GET', '/api/coach-month', { tenantId })).body;
  const omarId = before.coaches?.find((row) => row.name === 'Omar Nassar')?.coachUserId;

  // A free pack of its own, named for this run, sold to a client of Lea's.
  const stamp = Date.now().toString(36);
  const packName = `Personal training ${stamp}`;
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
  const origin = new URL(page.url()).origin;
  const tarekContext = await browser.newContext({ baseURL: origin });
  const tarek = await tarekContext.newPage();
  await signIn(tarek, ACCOUNTS.tarek);
  const clientId = (await api<{ id: string }>(tarek, 'GET', '/api/client-profile/me', { tenantId }))
    .body.id;
  const sold = await api(page, 'POST', `/api/commercial/clients/${clientId}/enrollments`, {
    tenantId,
    body: {
      offerId: product.body.offers[0].id,
      startDate: before.today,
      idempotencyKey: crypto.randomUUID(),
    },
  });
  expect(sold.status).toBe(200);

  // The owner starts on the client's coach, and chooses from the team, themselves as You.
  await page.goto(`/clients/${clientId}/service`);
  await page.getByRole('button', { name: 'Record a session' }).click();
  const sheet = page.getByRole('dialog', { name: 'Record a session' });
  const box = kitSelect(sheet, 'Who held it');
  await expect(box.locator('button.trigger')).toContainText('Lea Khoury');
  await box.locator('button.trigger').click();
  await expect(box.locator('[role="option"] .option-label')).toHaveText([
    'Lea Khoury',
    'You',
    'Omar Nassar',
  ]);
  await box.locator('[role="option"]').filter({ hasText: 'Omar Nassar' }).click();

  // A no-show is no session held, so it names nobody.
  await sheet.getByRole('radio', { name: 'No-show' }).click();
  await expect(kitSelect(sheet, 'Who held it')).toHaveCount(0);
  await sheet.getByRole('radio', { name: 'Held' }).click();
  await expect(kitSelect(sheet, 'Who held it').locator('button.trigger')).toContainText(
    'Omar Nassar',
  );
  await sheet.getByLabel('Note (optional)').fill(`Stood in ${stamp}`);
  await sheet.getByRole('button', { name: 'Record session' }).click();
  await expect(sheet).toBeHidden({ timeout: 30_000 });

  // The History keeps both people. A rerun's session goes on the pack ending first, an earlier run's.
  for (const fold of await page.locator('.pack summary').all()) await fold.click();
  await expect(page.locator('.ledger-detail').filter({ hasText: stamp })).toHaveText(
    `Held by Omar Nassar · recorded by Karim Haddad · Stood in ${stamp}`,
  );

  // A coach has no box, and a session they record is theirs.
  const leaContext = await browser.newContext({ baseURL: origin });
  const lea = await leaContext.newPage();
  await signIn(lea, ACCOUNTS.coachLea);
  await lea.goto(`/clients/${clientId}/service`);
  await lea.getByRole('button', { name: 'Record a session' }).click();
  const hers = lea.getByRole('dialog', { name: 'Record a session' });
  await expect(hers.getByText('Day of the session')).toBeVisible();
  await expect(kitSelect(hers, 'Who held it')).toHaveCount(0);
  await hers.getByRole('button', { name: 'Record session' }).click();
  await expect(hers).toBeHidden({ timeout: 30_000 });

  // Past the screen the server refuses her another name.
  const refused = await api<{ code: string }>(
    lea,
    'POST',
    `/api/commercial/clients/${clientId}/sessions`,
    {
      tenantId,
      body: {
        outcome: 'Held',
        day: before.today,
        note: null,
        reason: null,
        receipt: null,
        idempotencyKey: crypto.randomUUID(),
        heldByUserId: omarId,
      },
    },
  );
  expect(refused.status).toBe(409);
  expect(refused.body.code).toBe('session_held_by_someone_else');

  // Each month counts what they held, and the owner reads the same of them.
  const after = (await api<Report>(page, 'GET', '/api/coach-month', { tenantId })).body;
  expect(heldBy(after, 'Omar Nassar')).toBe(heldBy(before, 'Omar Nassar') + 1);
  expect(heldBy(after, 'Lea Khoury')).toBe(heldBy(before, 'Lea Khoury') + 1);
  expect(after.thisMonth.sessionsHeld).toBe(before.thisMonth.sessionsHeld + 2);
  const hersRead = (await api<Report>(lea, 'GET', '/api/coach-month', { tenantId })).body;
  expect(hersRead.thisMonth.sessionsHeld).toBe(heldBy(after, 'Lea Khoury'));

  // This month says a coaching plan apart from a pack, and whose a session is.
  await page.goto('/month');
  await expect(page.locator('[data-count="plans"] .part-label')).toHaveText('Coaching plans sold');
  await expect(page.getByRole('columnheader', { name: 'Coaching plans sold' })).toBeVisible();
  await page.getByText('How these are counted').click();
  await expect(page.locator('.how')).toContainText('for whoever held them');
  await expect(page.locator('.how')).toContainText(
    'A coaching plan is the coaching a client pays for over dates; a session pack is a set of 1-on-1 sessions.',
  );

  // The client reads neither person, nor the note.
  const read = await api(tarek, 'GET', '/api/client-plan/me', { tenantId });
  const words = JSON.stringify(read.body);
  expect(words).toContain(packName);
  for (const hidden of ['Omar', 'Karim', 'Stood in']) {
    expect(words).not.toContain(hidden);
  }

  await tarekContext.close();
  await leaContext.close();
});
