import type { Browser, Page } from '@playwright/test';
import {
  ACCOUNTS,
  LIVE_URL,
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
 * Release, leave and return, live (full audit, October 2026; ADR 0027): the owner ends coaching with a
 * client created here, every write to the record answers 409 client_released, the client's account
 * is left without a coaching space, the former client cannot be invited as a coach, and an invitation
 * to the same email brings them back through "sign in first" with a new profile beside the read-only
 * record. A second client created here leaves on their own and the owner is told in-app. Names carry
 * a run-unique suffix so a rerun on the same database never collides.
 */
requireLive();

function uuid(): string {
  return crypto.randomUUID();
}

interface Profile {
  id: string;
  version: number;
  onboardingStatus: string;
}

const suffix = Date.now().toString(36).slice(-4);

/** Invites `email` as Lea and accepts in a fresh context; returns the client's profile id. */
async function join(
  browser: Browser,
  page: Page,
  tenantId: string,
  email: string,
  firstName: string,
  lastName: string,
  password: string,
): Promise<string> {
  const invited = await api<{ developmentActionUrl: string }>(page, 'POST', '/api/invitations', {
    tenantId,
    body: {
      email,
      firstName,
      lastName,
      phoneNumber: null,
      birthDate: '1990-01-01',
      idempotencyKey: uuid(),
    },
  });
  expect(invited.status).toBe(201);
  const context = await browser.newContext({
    baseURL: LIVE_URL,
    timezoneId: 'Asia/Beirut',
    locale: 'en-US',
  });
  const guest = await context.newPage();
  await guest.goto(invited.body.developmentActionUrl);
  await guest.getByLabel('Display name').fill(`${firstName} ${lastName}`);
  await guest.getByLabel('Password', { exact: true }).fill(password);
  await guest.getByLabel('Confirm password').fill(password);
  await acceptLegalDocuments(guest);
  await guest.getByRole('button', { name: 'Create account and join' }).click();
  await expect(guest).toHaveURL(/\/profile/, { timeout: 30_000 });
  const me = await api<Profile>(guest, 'GET', '/api/client-profile/me', { tenantId });
  await context.close();
  return me.body.id;
}

test('the owner ends coaching: read-only record, no access, invited back as a new client only', async ({
  browser,
  page,
}) => {
  test.setTimeout(240_000);
  const baseURL = LIVE_URL!;
  const lea = await browser.newContext({ baseURL, timezoneId: 'Asia/Beirut', locale: 'en-US' });
  const leaPage = await lea.newPage();
  await signIn(leaPage, ACCOUNTS.coachLea);
  const [{ tenantId }] = await memberships(leaPage);
  const email = uniqueEmail('released.spec');
  const password = 'Released-Spec-2026!';
  const firstName = `Reem${suffix}`;
  const fullName = `${firstName} Released`;
  const clientId = await join(browser, leaPage, tenantId, email, firstName, 'Released', password);

  // The owner releases, with a reason.
  await signIn(page, ACCOUNTS.owner);
  await page.goto(`/clients/${clientId}/service`);
  await page.getByRole('button', { name: 'End coaching' }).click();
  const dialog = page.locator('dialog[open]').last();
  await expect(dialog).toContainText(`End coaching with ${fullName}?`);
  await dialog.getByLabel('Reason').fill('Moved to another city');
  await dialog.getByRole('button', { name: 'End coaching permanently' }).click();
  await expect(
    page.getByText(
      `Coaching with ${firstName} has ended. They no longer have access, and we are emailing them.`,
    ),
  ).toBeVisible();

  // Former clients lists her; the record is read-only; every write answers 409 client_released.
  await page.goto('/clients/former');
  const row = page.locator('.clients li.client-row', { hasText: fullName });
  await expect(row).toContainText('Ended by owner');
  await expect(row.locator('.reason')).toHaveText('Moved to another city');
  await page.goto(`/clients/${clientId}`);
  await expect(page.locator('.identity-card app-status-pill')).toHaveText('Former client');
  await expect(page.getByText('This record is kept read-only.')).toBeVisible();
  const writes = [
    api(page, 'PUT', `/api/clients/${clientId}/coach-notes`, {
      tenantId,
      body: { coachNotes: 'x', version: 1 },
    }),
    api(page, 'POST', `/api/clients/${clientId}/relationship/block`, {
      tenantId,
      body: { reason: 'x', version: 1 },
    }),
    api(page, 'POST', `/api/clients/${clientId}/release`, {
      tenantId,
      body: { reason: 'again', version: 1 },
    }),
  ];
  for (const result of await Promise.all(writes)) {
    expect(result.status).toBe(409);
    expect((result.body as { code: string }).code).toBe('client_released');
  }
  // Lea no longer coaches her: another coach's client answers as a missing one (ADR 0026).
  expect((await api(leaPage, 'GET', `/api/clients/${clientId}`, { tenantId })).status).toBe(404);
  expect(
    (
      await api(leaPage, 'PUT', `/api/clients/${clientId}/coach-notes`, {
        tenantId,
        body: { coachNotes: 'x', version: 1 },
      })
    ).status,
  ).toBe(404);

  // The released client: no coaching space, nothing readable with the tenant header.
  const released = await browser.newContext({
    baseURL,
    viewport: { width: 390, height: 844 },
    timezoneId: 'Asia/Beirut',
    locale: 'en-US',
  });
  const releasedPage = await released.newPage();
  await releasedPage.goto('/auth/sign-in');
  await releasedPage.getByLabel('Email').fill(email);
  await releasedPage.getByLabel('Password', { exact: true }).fill(password);
  await releasedPage.getByRole('button', { name: 'Sign in' }).click();
  await expect(
    releasedPage.getByRole('heading', { name: 'You are not part of a coaching space right now' }),
  ).toBeVisible({ timeout: 30_000 });
  expect((await api(releasedPage, 'GET', '/api/tenants')).body).toEqual([]);
  expect((await api(releasedPage, 'GET', '/api/client-access/me', { tenantId })).status).toBe(403);
  await released.close();

  // Never as a coach.
  const asCoach = await api<{ code: string }>(page, 'POST', '/api/team/invitations', {
    tenantId,
    body: { email, firstName, lastName: 'Released', idempotencyKey: uuid() },
  });
  expect(asCoach.status).toBe(409);

  // Invited back as a client: sign in first, accept, a new profile; the old record stays.
  const again = await api<{ developmentActionUrl: string }>(leaPage, 'POST', '/api/invitations', {
    tenantId,
    body: {
      email,
      firstName,
      lastName: 'Released',
      phoneNumber: null,
      birthDate: null,
      idempotencyKey: uuid(),
    },
  });
  expect(again.status).toBe(201);
  const back = await browser.newContext({ baseURL, timezoneId: 'Asia/Beirut', locale: 'en-US' });
  const backPage = await back.newPage();
  await backPage.goto(again.body.developmentActionUrl);
  await expect(
    backPage.getByText('An account already exists for this email. Sign in to continue.'),
  ).toBeVisible();
  await backPage.getByRole('link', { name: 'Sign in to accept' }).click();
  // Sign-in comes back to the invitation without the token in its address (audit WEB-10).
  await expect(backPage).toHaveURL(/\/auth\/sign-in\?returnUrl=%2Finvite$/);
  expect(
    await backPage.evaluate(() => JSON.stringify([history.state, { ...sessionStorage }])),
  ).not.toContain(new URL(again.body.developmentActionUrl).searchParams.get('token') ?? 'no token');
  await backPage.getByLabel('Email').fill(email);
  await backPage.getByLabel('Password', { exact: true }).fill(password);
  await backPage.getByRole('button', { name: 'Sign in' }).click();
  await expect(backPage.getByText(`Accept this invitation using ${email}.`)).toBeVisible({
    timeout: 30_000,
  });
  await acceptLegalDocuments(backPage);
  await backPage.getByRole('button', { name: 'Accept invitation' }).click();
  await expect(backPage).toHaveURL(/\/profile/, { timeout: 30_000 });
  const fresh = await api<Profile>(backPage, 'GET', '/api/client-profile/me', { tenantId });
  expect(fresh.body.id).not.toBe(clientId);
  expect(fresh.body.onboardingStatus).toBe('NotStarted');
  await back.close();
  await page.goto('/clients/former');
  await expect(page.locator('.clients li.client-row', { hasText: fullName })).toContainText(
    'Ended by owner',
  );
  await page.goto('/clients');
  await expect(
    page.locator('.clients li.client-row', { hasText: fullName }).locator('.plan'),
  ).toHaveText('No plan yet');
  await lea.close();
});

test('a client leaves on their own and the owner is told in-app', async ({ browser, page }) => {
  test.setTimeout(180_000);
  const baseURL = LIVE_URL!;
  await signIn(page, ACCOUNTS.coachLea);
  const [{ tenantId }] = await memberships(page);
  const email = uniqueEmail('leaver.spec');
  const password = 'Leaver-Spec-2026!';
  const firstName = `Lina${suffix}`;
  const clientId = await join(browser, page, tenantId, email, firstName, 'Leaver', password);

  const phone = await browser.newContext({
    baseURL,
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    timezoneId: 'Asia/Beirut',
    locale: 'en-US',
  });
  const client = await phone.newPage();
  await signIn(client, email, password);
  await client.goto('/account/security');
  await client.locator('[data-leave]').click();
  const dialog = client.getByRole('dialog');
  await expect(dialog).toContainText('You lose access right away, including your history there.');
  await dialog.locator('#leave-reason').fill('Moving abroad');
  await dialog.getByRole('button', { name: 'Leave permanently' }).click();
  await expect(
    client.getByRole('heading', { name: 'You are not part of a coaching space right now' }),
  ).toBeVisible({ timeout: 30_000 });
  await phone.close();

  const owner = await browser.newContext({ baseURL, timezoneId: 'Asia/Beirut', locale: 'en-US' });
  const ownerPage = await owner.newPage();
  await signIn(ownerPage, ACCOUNTS.owner);
  await ownerPage.goto('/clients/former');
  const row = ownerPage.locator('.clients li.client-row', { hasText: `${firstName} Leaver` });
  await expect(row).toContainText('Left by client');
  await expect(row.locator('.reason')).toHaveText('Moving abroad');
  // The Worker delivers the in-app notice within a few seconds, naming who left (audit COACH-12).
  await expect
    .poll(
      async () => {
        const result = await api<
          { items?: { kind: string; title: string }[] } | { kind: string; title: string }[]
        >(ownerPage, 'GET', '/api/notifications', { tenantId });
        const items = Array.isArray(result.body) ? result.body : (result.body.items ?? []);
        return items.find((item) => item.kind === 'ClientLeft')?.title ?? null;
      },
      { timeout: 30_000 },
    )
    .toBe(`${firstName} Leaver left your coaching space`);
  const write = await api(ownerPage, 'PUT', `/api/clients/${clientId}/coach-notes`, {
    tenantId,
    body: { coachNotes: 'x', version: 1 },
  });
  expect(write.status).toBe(409);
  await owner.close();
});
