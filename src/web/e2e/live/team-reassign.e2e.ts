import type { Browser, Page } from '@playwright/test';
import {
  ACCOUNTS,
  LIVE_URL,
  api,
  expect,
  memberships,
  requireLive,
  signIn,
  test,
  uniqueEmail,
} from './support';

/**
 * Team, live (full audit, October 2026; ADR 0026): the owner invites a coach who joins in a signed-out
 * context, reassigns a client created here with a note, the chat rule holds for a Coach (the old coach
 * loses the thread, the client keeps it read-only, the new coach starts fresh), the coach resigns from
 * Settings and their client and pending invitation move to the owner, and a second coach is removed
 * from Team with the client told. The last test pins the same chat rule for the owner as old coach (audit
 * finding COACH-13): the owner's thread closes, the client keeps it read-only, and the owner's screens say
 * who messages the client instead of offering a chat. Names carry a run-unique suffix so a rerun on the
 * same database never collides.
 */
requireLive();

function uuid(): string {
  return crypto.randomUUID();
}

interface Conversation {
  id: string;
  clientProfileId: string;
  isReadOnly?: boolean;
  counterpart: { userId: string; displayName: string };
}
interface Assignment {
  sequence: number;
  coachName: string;
  reason: string;
  note: string | null;
}
interface Offer {
  id: string;
  isActive: boolean;
  priceAmount: number;
  priceCurrency: string;
  features: { feature: string }[];
}

const suffix = Date.now().toString(36).slice(-4);

const context = (browser: Browser, phone = false) =>
  browser.newContext({
    baseURL: LIVE_URL,
    viewport: phone ? { width: 390, height: 844 } : { width: 1440, height: 900 },
    isMobile: phone,
    hasTouch: phone,
    timezoneId: 'Asia/Beirut',
    locale: 'en-US',
  });

function beirutToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Beirut' }).format(new Date());
}

/** Lea invites a client who accepts in a fresh context and gets a paid plan that includes messaging. */
async function newClient(
  browser: Browser,
  lea: Page,
  tenantId: string,
  firstName: string,
): Promise<{ id: string; email: string; name: string; page: Page }> {
  const email = uniqueEmail('team.client');
  const name = `${firstName} Team`;
  const invited = await api<{ developmentActionUrl: string }>(lea, 'POST', '/api/invitations', {
    tenantId,
    body: {
      email,
      firstName,
      lastName: 'Team',
      phoneNumber: null,
      birthDate: '1992-04-04',
      idempotencyKey: uuid(),
    },
  });
  expect(invited.status).toBe(201);
  const page = await (await context(browser, true)).newPage();
  await page.goto(invited.body.developmentActionUrl);
  await page.getByLabel('Display name').fill(name);
  await page.getByLabel('Password', { exact: true }).fill('Team-Client-2026!');
  await page.getByLabel('Confirm password').fill('Team-Client-2026!');
  await page.getByRole('button', { name: 'Create account and join' }).click();
  await expect(page).toHaveURL(/\/profile/, { timeout: 30_000 });
  const me = await api<{ id: string }>(page, 'GET', '/api/client-profile/me', { tenantId });
  // Messaging needs a plan that includes it, paid in full.
  const catalog = await api<{ products: { offers: Offer[] }[] }>(
    lea,
    'GET',
    '/api/commercial/products',
    {
      tenantId,
    },
  );
  const offer = catalog.body.products
    .flatMap((product) => product.offers)
    .find(
      (item) => item.isActive && item.features.some((feature) => feature.feature === 'Messaging'),
    )!;
  const plan = await api<{ id: string }>(
    lea,
    'POST',
    `/api/commercial/clients/${me.body.id}/enrollments`,
    {
      tenantId,
      body: { offerId: offer.id, startDate: beirutToday(), idempotencyKey: uuid() },
    },
  );
  expect(plan.status).toBeLessThan(300);
  const paid = await api(lea, 'POST', `/api/commercial/enrollments/${plan.body.id}/payments`, {
    tenantId,
    body: {
      amount: offer.priceAmount,
      currencyCode: offer.priceCurrency,
      receivedAtUtc: new Date().toISOString(),
      method: 'Cash',
      reference: null,
      note: null,
      idempotencyKey: uuid(),
    },
  });
  expect(paid.status).toBe(200);
  return { id: me.body.id, email, name, page };
}

/** The owner invites a coach from Team who accepts in a fresh context. */
async function newCoach(
  browser: Browser,
  owner: Page,
  tenantId: string,
  firstName: string,
): Promise<{ page: Page; name: string; email: string }> {
  const email = uniqueEmail('team.coach');
  const name = `${firstName} Spec`;
  await owner.goto('/team');
  await owner.getByRole('button', { name: 'Invite a coach' }).click();
  const sheet = owner.getByRole('dialog');
  await sheet.getByLabel('Email').fill(email);
  await sheet.getByLabel('First name').fill(firstName);
  await sheet.getByLabel('Last name').fill('Spec');
  await sheet.getByRole('button', { name: 'Send invitation' }).click();
  await expect(owner.getByText(`Invitation sent to ${email}.`)).toBeVisible();
  const invitations = await api<
    | { email: string; developmentActionUrl: string }[]
    | { items: { email: string; developmentActionUrl: string }[] }
  >(owner, 'GET', '/api/team/invitations', { tenantId });
  const link = (Array.isArray(invitations.body) ? invitations.body : invitations.body.items).find(
    (item) => item.email === email,
  )!.developmentActionUrl;
  const page = await (await context(browser)).newPage();
  await page.goto(link);
  await expect(page.getByRole('heading', { name: /Join the coaching team/ })).toBeVisible();
  await page.getByLabel('Display name').fill(name);
  await page.getByLabel('Password', { exact: true }).fill('Team-Coach-2026!');
  await page.getByLabel('Confirm password').fill('Team-Coach-2026!');
  await page.getByRole('button', { name: 'Create account and join' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText(firstName, {
    timeout: 30_000,
  });
  return { page, name, email };
}

async function assignments(page: Page, tenantId: string, clientId: string): Promise<Assignment[]> {
  const result = await api<Assignment[]>(
    page,
    'GET',
    `/api/clients/${clientId}/coach-assignments`,
    { tenantId },
  );
  expect(result.status).toBe(200);
  return result.body;
}

async function conversations(page: Page, tenantId: string): Promise<Conversation[]> {
  const result = await api<Conversation[] | { items: Conversation[] }>(
    page,
    'GET',
    '/api/messaging/conversations',
    {
      tenantId,
    },
  );
  expect(result.status).toBe(200);
  return Array.isArray(result.body) ? result.body : result.body.items;
}

async function notificationKinds(page: Page, tenantId: string): Promise<string[]> {
  const result = await api<{ kind: string }[] | { items: { kind: string }[] }>(
    page,
    'GET',
    '/api/notifications',
    {
      tenantId,
    },
  );
  return (Array.isArray(result.body) ? result.body : result.body.items).map((item) => item.kind);
}

async function reassign(
  owner: Page,
  clientId: string,
  coachName: string,
  note: string,
): Promise<void> {
  await owner.goto(`/clients/${clientId}/service`);
  await owner.getByRole('button', { name: 'Reassign coach' }).click();
  const dialog = owner.locator('dialog[open]').last();
  await dialog.locator('select').selectOption({ label: coachName });
  await dialog.getByLabel(/Note/).fill(note);
  await dialog.getByRole('button', { name: 'Reassign', exact: true }).click();
  await expect(owner.locator('.coach-notice')).toHaveText(
    new RegExp(`now has ${coachName} as their coach`),
  );
}

test('a coach joins, takes a client with a note, the chat rule holds, and the coach resigns', async ({
  browser,
  page,
}) => {
  test.setTimeout(300_000);
  await signIn(page, ACCOUNTS.owner);
  const [{ tenantId }] = await memberships(page);
  const lea = await (await context(browser)).newPage();
  await signIn(lea, ACCOUNTS.coachLea);
  const client = await newClient(browser, lea, tenantId, `Tala${suffix}`);

  // Lea opens a conversation with her client and writes first.
  const started = await api<{ conversation: Conversation }>(
    lea,
    'POST',
    '/api/messaging/conversations',
    {
      tenantId,
      body: { clientProfileId: client.id, idempotencyKey: uuid() },
    },
  );
  expect(started.status).toBeLessThan(300);
  const oldThread = started.body.conversation.id;
  const first = await api(lea, 'POST', `/api/messaging/conversations/${oldThread}/messages`, {
    tenantId,
    body: { body: 'Welcome!', idempotencyKey: uuid() },
  });
  expect(first.status).toBe(200);

  const coach = await newCoach(browser, page, tenantId, `Nabil${suffix}`);
  await page.goto('/team');
  await expect(page.locator('li.person', { hasText: coach.name })).toContainText('0 clients');

  // Reassign from Service & access, with a note kept in the history.
  await reassign(page, client.id, coach.name, 'Nabil takes the evening lifters.');
  const history = await assignments(page, tenantId, client.id);
  expect(history.map((entry) => [entry.sequence, entry.reason, entry.note])).toEqual([
    [1, 'Invitation', null],
    [2, 'Reassigned', 'Nabil takes the evening lifters.'],
  ]);
  await page.goto('/clients');
  await expect(
    page.locator('.clients li.client-row', { hasText: client.name }).locator('.coach'),
  ).toHaveText(`Coached by ${coach.name}`);
  await coach.page.goto('/clients');
  await expect(
    coach.page.locator('.clients li.client-row', { hasText: client.name }),
  ).toBeVisible();

  // The chat rule: Lea loses the thread, the client keeps it read-only, the new coach starts fresh.
  expect((await api(lea, 'GET', `/api/clients/${client.id}`, { tenantId })).status).toBe(404);
  expect(
    (await api(lea, 'GET', `/api/messaging/conversations/${oldThread}/messages`, { tenantId }))
      .status,
  ).toBe(404);
  expect((await conversations(lea, tenantId)).some((item) => item.id === oldThread)).toBe(false);
  const clientThreads = await conversations(client.page, tenantId);
  expect(clientThreads.find((item) => item.id === oldThread)?.isReadOnly).toBe(true);
  const clientWrite = await api<{ title: string }>(
    client.page,
    'POST',
    `/api/messaging/conversations/${oldThread}/messages`,
    {
      tenantId,
      body: { body: 'Still here?', idempotencyKey: uuid() },
    },
  );
  expect(clientWrite.status).toBe(409);
  expect(clientWrite.body.title).toBe(
    'This conversation is read-only because the client now has a different coach.',
  );
  expect(
    (
      await api(coach.page, 'GET', `/api/messaging/conversations/${oldThread}/messages`, {
        tenantId,
      })
    ).status,
  ).toBe(404);
  const fresh = await api<{ conversation: Conversation }>(
    coach.page,
    'POST',
    '/api/messaging/conversations',
    {
      tenantId,
      body: { clientProfileId: client.id, idempotencyKey: uuid() },
    },
  );
  expect(fresh.status).toBeLessThan(300);
  expect(fresh.body.conversation.id).not.toBe(oldThread);

  // The coach invites a client, then resigns from Settings: client and invitation move to the owner.
  const pendingEmail = uniqueEmail('team.pending');
  expect(
    (
      await api(coach.page, 'POST', '/api/invitations', {
        tenantId,
        body: {
          email: pendingEmail,
          firstName: 'Pending',
          lastName: 'Invitee',
          phoneNumber: null,
          birthDate: null,
          idempotencyKey: uuid(),
        },
      })
    ).status,
  ).toBe(201);
  await coach.page.goto('/account/security');
  await coach.page.locator('[data-leave]').click();
  const leave = coach.page.getByRole('dialog');
  await expect(leave).toContainText(
    'Your clients and any client invitations you sent move to the owner',
  );
  await leave.getByRole('button', { name: 'Leave permanently' }).click();
  await expect(
    coach.page.getByRole('heading', { name: 'You are not part of a coaching space right now' }),
  ).toBeVisible({ timeout: 30_000 });
  const afterResign = await assignments(page, tenantId, client.id);
  expect(afterResign.at(-1)?.reason).toBe('CoachResigned');
  expect(afterResign.at(-1)?.coachName).toBe('Karim Haddad');
  const invitations = await api<{ email: string }[] | { items: { email: string }[] }>(
    page,
    'GET',
    '/api/invitations',
    {
      tenantId,
    },
  );
  expect(
    (Array.isArray(invitations.body) ? invitations.body : invitations.body.items).some(
      (item) => item.email === pendingEmail,
    ),
  ).toBe(true);
  await page.goto('/team');
  await expect(page.locator('li.person', { hasText: coach.name })).toHaveCount(0);
  // The owner and the client are told, within the Worker's sweep.
  await expect
    .poll(() => notificationKinds(page, tenantId), { timeout: 30_000 })
    .toContain('CoachResigned');
  await expect
    .poll(() => notificationKinds(client.page, tenantId), { timeout: 30_000 })
    .toContain('CoachDeparted');
  await client.page.goto('/');
  await expect(client.page.locator('.today-coach')).toContainText('Karim Haddad');
  await client.page.context().close();
  await coach.page.context().close();
  await lea.context().close();
});

test('the owner removes a coach from Team: their client moves to the owner and is told', async ({
  browser,
  page,
}) => {
  test.setTimeout(300_000);
  await signIn(page, ACCOUNTS.owner);
  const [{ tenantId }] = await memberships(page);
  const lea = await (await context(browser)).newPage();
  await signIn(lea, ACCOUNTS.coachLea);
  const client = await newClient(browser, lea, tenantId, `Rawan${suffix}`);
  const coach = await newCoach(browser, page, tenantId, `Samer${suffix}`);
  await reassign(page, client.id, coach.name, 'Samer takes Rawan.');

  await page.goto('/team');
  await page.getByRole('button', { name: `More for ${coach.name}` }).click();
  await page.locator('button.item', { hasText: 'Remove from the team' }).click();
  const ask = page.getByRole('dialog');
  // "Their 1 clients" is a plural slip the audit recorded (COACH-18); the rule itself is what matters here.
  await expect(ask).toContainText(/Their 1 clients? moves? to you with all their history/);
  await ask.getByRole('button', { name: 'Remove coach' }).click();
  // The toast repeats the plural slip ("1 clients moved to you", COACH-18); the move itself is what matters.
  await expect(
    page.getByText(new RegExp(`${coach.name} left the team. 1 clients? moved to you.`)),
  ).toBeVisible();
  await expect(page.locator('li.person', { hasText: coach.name })).toHaveCount(0);
  const history = await assignments(page, tenantId, client.id);
  expect(history.at(-1)?.reason).toBe('CoachRemoved');
  expect(history.at(-1)?.coachName).toBe('Karim Haddad');
  await expect
    .poll(() => notificationKinds(client.page, tenantId), { timeout: 30_000 })
    .toContain('CoachDeparted');
  await coach.page.reload();
  await expect(
    coach.page.getByRole('heading', { name: 'You are not part of a coaching space right now' }),
  ).toBeVisible({ timeout: 30_000 });
  await client.page.context().close();
  await coach.page.context().close();
  await lea.context().close();
});

test('the owner as old coach loses the thread too (ADR 0026, COACH-13)', async ({
  browser,
  page,
}) => {
  test.setTimeout(300_000);
  await signIn(page, ACCOUNTS.owner);
  const [{ tenantId }] = await memberships(page);
  const lea = await (await context(browser)).newPage();
  await signIn(lea, ACCOUNTS.coachLea);
  const client = await newClient(browser, lea, tenantId, `Dina${suffix}`);
  // The client becomes the owner's first, so the owner is the old coach afterwards.
  await reassign(page, client.id, 'Karim Haddad', 'Owner coaches Dina first.');
  const thread = await api<{ conversation: Conversation }>(
    page,
    'POST',
    '/api/messaging/conversations',
    {
      tenantId,
      body: { clientProfileId: client.id, idempotencyKey: uuid() },
    },
  );
  expect(thread.status).toBeLessThan(300);
  expect(
    (
      await api(
        page,
        'POST',
        `/api/messaging/conversations/${thread.body.conversation.id}/messages`,
        {
          tenantId,
          body: { body: 'Hello from the owner.', idempotencyKey: uuid() },
        },
      )
    ).status,
  ).toBe(200);
  await reassign(page, client.id, 'Lea Khoury', 'Lea takes Dina.');

  // The same rule a Coach gets: read-only for the client, closed for the old coach.
  const clientThreads = await conversations(client.page, tenantId);
  expect(clientThreads.find((item) => item.id === thread.body.conversation.id)?.isReadOnly).toBe(
    true,
  );
  expect(
    (
      await api(
        client.page,
        'POST',
        `/api/messaging/conversations/${thread.body.conversation.id}/messages`,
        {
          tenantId,
          body: { body: 'Still open?', idempotencyKey: uuid() },
        },
      )
    ).status,
  ).toBe(409);
  expect(
    (
      await api(
        page,
        'POST',
        `/api/messaging/conversations/${thread.body.conversation.id}/messages`,
        {
          tenantId,
          body: { body: 'Owner writes on.', idempotencyKey: uuid() },
        },
      )
    ).status,
  ).not.toBe(200);
  expect(
    (
      await api(
        page,
        'GET',
        `/api/messaging/conversations/${thread.body.conversation.id}/messages`,
        {
          tenantId,
        },
      )
    ).status,
  ).toBe(404);

  // On screen: the owner is told who messages the client, and the owner's inbox no longer lists them.
  await page.goto(`/clients/${client.id}`);
  await expect(page.locator('.messaging-note')).toHaveText('Messages go through Lea Khoury.');
  await expect(page.getByRole('button', { name: /^Message / })).toHaveCount(0);
  await page.goto('/messages');
  await expect(page.locator('#messages-heading')).toBeVisible();
  await expect(page.locator('button.conversation', { hasText: client.name })).toHaveCount(0);

  // The client reads the old thread, its only one so it opens by itself, sees who it was with, and is
  // offered no composer in it.
  await client.page.goto('/messages');
  await expect(client.page.locator('#thread-heading')).toHaveText('Karim Haddad');
  await expect(client.page.locator('.thread-role')).toHaveText('Your former coach');
  await expect(client.page.locator('.read-only-notice')).toBeVisible();
  await expect(client.page.locator('#draft')).toHaveCount(0);
  await client.page.context().close();
  await lea.context().close();
});
