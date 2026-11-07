import type { Browser, Page } from '@playwright/test';
import {
  ACCOUNTS,
  api,
  DEMO_PASSWORD,
  expect,
  memberships,
  requireLive,
  signIn,
  test,
} from './support';

/**
 * Me against a live API (M8, CLI-017): Appearance and Body weight save on the account and follow
 * the client to another signed-in browser; notification settings refuse a stale save; a password
 * change works and "Sign out everywhere" ends the other browser's session. Every change is put back
 * at the end (in a finally), so a rerun starts from the demo's own state.
 *
 * What TB Gym shows about the coach (notes plan N4b, CLI-021): a certificate line the platform admin
 * confirms for the client's coach shows on Me under Your coach, until it is taken down or the coach
 * switches it off on their own Certificates page. Those checks need the platform admin's account
 * (TB_GYM_LIVE_ADMIN_EMAIL, TB_GYM_LIVE_ADMIN_PASSWORD) and are skipped without it; each run records
 * a line in words of its own and takes it down at the end, since a confirmed line is never dropped.
 * So, unlike the rest of this file, they leave a taken-down line on the coach's record each run
 * (shown on the coach's Certificates page and the admin's Coaches page until the keeping period
 * erases it): give the admin's account only on a throwaway demo, never on one shown to people.
 */
requireLive();

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

const CLIENT = ACCOUNTS.hadi;
const TEMP_PASSWORD = 'LiveCheck-Temp-2026!x';

test('My plan reads the plan the coach sold, from the coach’s own catalog', async ({ page }) => {
  await signIn(page, CLIENT);
  await page.goto('/me');
  await page.getByRole('link', { name: /My plan/ }).click();
  await expect(page.getByRole('heading', { name: 'My plan', level: 1 })).toBeVisible();

  const plan = page.locator('section.plan').first();
  await expect(plan.getByRole('heading', { level: 2 })).toHaveText('Online Coaching');
  await expect(plan.getByRole('heading', { name: 'What’s included' })).toBeVisible();
  await expect(plan.getByText('Your own program, a weekly check-in')).toBeVisible();
  await expect(page.locator('main')).not.toContainText(/USD|paid/i);
});

test('Appearance and Body weight are saved on the account and followed elsewhere', async ({
  page,
  browser,
}) => {
  await signIn(page, CLIENT);
  await page.goto('/me');
  await expect(page.getByRole('heading', { name: 'Me' })).toBeVisible();
  try {
    await page.getByRole('radio', { name: 'Dark' }).click();
    await expect
      .poll(
        async () =>
          (await api<{ preferredThemeMode: string }>(page, 'GET', '/api/auth/me')).body
            .preferredThemeMode,
      )
      .toBe('dark');
    await expect
      .poll(() => page.evaluate(() => getComputedStyle(document.documentElement).colorScheme))
      .toBe('dark');

    const other = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      locale: 'en-US',
      timezoneId: 'Asia/Beirut',
      baseURL: process.env['TB_GYM_LIVE_URL'],
    });
    const second = await other.newPage();
    await signIn(second, CLIENT);
    await expect
      .poll(() => second.evaluate(() => getComputedStyle(document.documentElement).colorScheme))
      .toBe('dark');
    await second.goto('/me');
    await expect(second.getByRole('radio', { name: 'Dark' })).toBeChecked();
    await other.close();

    await page.getByRole('radio', { name: 'lb' }).click();
    await expect
      .poll(
        async () =>
          (await api<{ preferredWeightUnit: string }>(page, 'GET', '/api/auth/me')).body
            .preferredWeightUnit,
      )
      .toBe('Pound');
    await expect(page.locator('.pref-error')).toHaveText('');
  } finally {
    await api(page, 'PUT', '/api/auth/me/theme', { body: { mode: 'system' } });
    await api(page, 'PUT', '/api/auth/me/weight-unit', { body: { unit: 'Kilogram' } });
  }
});

test('notification settings refuse a stale save from a second tab', async ({ page, context }) => {
  await signIn(page, CLIENT);
  const tenantId = (await memberships(page))[0].tenantId;
  const original = await api<Record<string, unknown>>(
    page,
    'GET',
    '/api/notifications/preferences',
    {
      tenantId,
    },
  );
  expect(original.status).toBe(200);
  await page.goto('/notifications/settings');
  await expect(page.getByRole('heading', { name: 'Notification settings' })).toBeVisible();
  const second = await context.newPage();
  await second.goto('/notifications/settings');
  await expect(second.getByRole('heading', { name: 'Notification settings' })).toBeVisible();
  try {
    const quiet = page.getByLabel('Hold emails during quiet hours');
    await quiet.click();
    if (await quiet.isChecked()) {
      await page.getByLabel('From').fill('22:00');
      await page.getByLabel('Until').fill('07:00');
    }
    await page.getByRole('button', { name: 'Save settings' }).click();
    await expect(page.getByText('Your notification settings were saved.')).toBeVisible();

    await second.getByLabel('Email me about my coaching plan').click();
    await second.getByRole('button', { name: 'Save settings' }).click();
    await expect(
      second.getByText(
        'Your notification settings were changed by another request. Reload and try again.',
      ),
    ).toBeVisible();
  } finally {
    await second.close();
    const current = await api<Record<string, unknown>>(
      page,
      'GET',
      '/api/notifications/preferences',
      {
        tenantId,
      },
    );
    await api(page, 'PUT', '/api/notifications/preferences', {
      tenantId,
      body: {
        emailMarketingEnabled: original.body['emailMarketingEnabled'],
        quietHoursEnabled: original.body['quietHoursEnabled'],
        quietHoursStartLocal: original.body['quietHoursStartLocal'],
        quietHoursEndLocal: original.body['quietHoursEndLocal'],
        version: current.body['version'],
      },
    });
  }
});

test('a password change works and Sign out everywhere ends the other session', async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  await signIn(page, CLIENT);
  await page.goto('/account/security');
  await expect(page.getByRole('heading', { name: 'Password and security' })).toBeVisible();
  let changed = false;
  try {
    await page.getByLabel('Current password').fill('WrongPassword-1!');
    await page.getByLabel('New password', { exact: true }).fill(TEMP_PASSWORD);
    await page.getByLabel('New password again').fill(TEMP_PASSWORD);
    await page.getByRole('button', { name: 'Change password' }).click();
    // Identity's refusal in the app's words (audit AUTH-6); it was "Incorrect password.".
    await expect(page.getByText("Your current password isn't right.")).toBeVisible();

    await page.getByLabel('Current password').fill(DEMO_PASSWORD);
    await page.getByRole('button', { name: 'Change password' }).click();
    await expect(
      page.getByText('Password changed. Use the new one next time you sign in.'),
    ).toBeVisible();
    changed = true;

    const other = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      locale: 'en-US',
      timezoneId: 'Asia/Beirut',
      baseURL: process.env['TB_GYM_LIVE_URL'],
    });
    const second = await other.newPage();
    await signIn(second, CLIENT, TEMP_PASSWORD);
    // The session check names the account, or answers null for nobody (audit AUTH-12).
    expect((await api(second, 'GET', '/api/auth/me')).body).not.toBeNull();

    await page.locator('[data-sign-out-everywhere]').click();
    await expect(page.locator('app-confirm')).toContainText('this one too');
    await page
      .locator('[role="dialog"]:has(app-confirm) button', { hasText: 'Sign out everywhere' })
      .click();
    await page.waitForURL((url) => url.pathname.startsWith('/auth'), { timeout: 30_000 });
    await expect.poll(async () => (await api(second, 'GET', '/api/auth/me')).body).toBeNull();
    await other.close();
  } finally {
    if (changed) {
      await signIn(page, CLIENT, TEMP_PASSWORD);
      await page.goto('/account/security');
      await page.getByLabel('Current password').fill(TEMP_PASSWORD);
      await page.getByLabel('New password', { exact: true }).fill(DEMO_PASSWORD);
      await page.getByLabel('New password again').fill(DEMO_PASSWORD);
      await page.getByRole('button', { name: 'Change password' }).click();
      await expect(
        page.getByText('Password changed. Use the new one next time you sign in.'),
      ).toBeVisible();
    }
  }
});

// ---------- what TB Gym shows about the coach (notes plan N4b) ----------

const ADMIN_EMAIL = process.env['TB_GYM_LIVE_ADMIN_EMAIL'];
const ADMIN_PASSWORD = process.env['TB_GYM_LIVE_ADMIN_PASSWORD'];

/** One staff membership on the admin's Coaches list (`GET /api/platform-admin/coaches`). */
interface CertificateCoach {
  userId: string;
  name: string;
  email: string;
  tenantId: string;
  isActiveStaff: boolean;
}

interface CertificateLine {
  id: string;
  state: 'Waiting' | 'Confirmed' | 'TakenDown' | 'Erased';
  text: string | null;
  coachShows: boolean;
  version: number;
}

interface CertificateLines {
  spaceToday: string;
  lines: CertificateLine[];
}

/** A line this run recorded: its admin route, its words and the version last answered. */
interface RecordedLine {
  id: string;
  base: string;
  what: string;
  text: string;
  version: number;
}

/** A second browser at a desk's width, as the admin and the coach work. */
async function deskPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: 'en-US',
    timezoneId: 'Asia/Beirut',
    baseURL: process.env['TB_GYM_LIVE_URL'],
  });
  return context.newPage();
}

/** The coach of the client's current profile, in the client's open space, as the admin lists them. */
async function clientsCoach(client: Page, admin: Page): Promise<CertificateCoach> {
  const [membership] = await memberships(client);
  const coach = await api<{ name: string }>(client, 'GET', '/api/client-profile/me/coach', {
    tenantId: membership.tenantId,
  });
  expect(coach.status, 'the client’s coach').toBe(200);
  const coaches = await api<CertificateCoach[]>(admin, 'GET', '/api/platform-admin/coaches');
  expect(coaches.status).toBe(200);
  const row = coaches.body.find(
    (item) =>
      item.tenantId === membership.tenantId && item.name === coach.body.name && item.isActiveStaff,
  );
  expect(row, 'the client’s coach on the admin’s Coaches list').toBeDefined();
  return row!;
}

/** Records a waiting line for the coach in that space, in words of this run's own. */
async function recordLine(admin: Page, coach: CertificateCoach): Promise<RecordedLine> {
  const base = `/api/platform-admin/coaches/${coach.userId}/spaces/${coach.tenantId}`;
  const record = await api<CertificateLines>(admin, 'GET', `${base}/lines`);
  expect(record.status).toBe(200);
  // The same words and day again would answer the line an earlier run recorded.
  const what = `Barbell coaching course, live check ${Date.now().toString(36)}`;
  const added = await api<CertificateLine>(admin, 'POST', `${base}/lines`, {
    body: { what, shownOn: record.body.spaceToday },
  });
  expect(added.status).toBe(201);
  return {
    id: added.body.id,
    base,
    what,
    text: added.body.text ?? '',
    version: added.body.version,
  };
}

/** Marks the line confirmed, as the trainer partner's word reached TB Gym: it starts shown. */
async function confirmLine(admin: Page, line: RecordedLine): Promise<RecordedLine> {
  const confirmed = await api<CertificateLine>(
    admin,
    'POST',
    `${line.base}/lines/${line.id}/confirm`,
    { body: { confirmedByName: 'Live check', version: line.version } },
  );
  expect(confirmed.status).toBe(200);
  expect(confirmed.body.state).toBe('Confirmed');
  expect(confirmed.body.coachShows).toBe(true);
  expect(confirmed.body.text).toContain(line.what);
  return { ...line, text: confirmed.body.text!, version: confirmed.body.version };
}

/** Leaves no line of this run up: a waiting one is dropped, a confirmed one taken down. */
async function putAway(admin: Page, line: RecordedLine): Promise<void> {
  const now = await api<CertificateLines>(admin, 'GET', `${line.base}/lines`);
  const mine = now.body.lines?.find((item) => item.id === line.id);
  if (mine?.state === 'Waiting') {
    await api(admin, 'POST', `${line.base}/lines/${line.id}/drop`, {
      body: { version: mine.version },
    });
  }
  if (mine?.state === 'Confirmed') {
    await api(admin, 'POST', `${line.base}/lines/${line.id}/take-down`, {
      body: { version: mine.version },
    });
  }
}

/** The client's Me, read again, with the coach's card drawn. */
async function openMe(client: Page, coach: CertificateCoach) {
  await client.goto('/me');
  await expect(client.getByRole('heading', { name: 'Me', level: 1 })).toBeVisible();
  const card = client.locator('.hero .coach:not(.coach--waiting)');
  await expect(card).toContainText(coach.name);
  return card;
}

test.describe('what TB Gym shows about the coach', () => {
  test.skip(
    !ADMIN_EMAIL || !ADMIN_PASSWORD,
    'Set TB_GYM_LIVE_ADMIN_EMAIL and TB_GYM_LIVE_ADMIN_PASSWORD to an account granted the platform-admin role.',
  );

  test('a line TB Gym confirmed for the coach shows on Me under Your coach, until it is taken down', async ({
    page,
    browser,
  }) => {
    test.setTimeout(180_000);
    await signIn(page, CLIENT);
    const admin = await deskPage(browser);
    let line: RecordedLine | null = null;
    try {
      await signIn(admin, ADMIN_EMAIL!, ADMIN_PASSWORD!);
      const coach = await clientsCoach(page, admin);
      line = await recordLine(admin, coach);

      // Waiting for TB Gym's word, the line is nowhere on Me.
      let card = await openMe(page, coach);
      await expect(card.locator('[data-coach-line]', { hasText: line.what })).toHaveCount(0);

      line = await confirmLine(admin, line);
      card = await openMe(page, coach);
      const shown = card.locator('[data-coach-line]', { hasText: line.what });
      await expect(shown).toHaveText(line.text);
      await expect(shown.locator('bdi')).toHaveText(line.text);

      const down = await api<CertificateLine>(
        admin,
        'POST',
        `${line.base}/lines/${line.id}/take-down`,
        { body: { version: line.version } },
      );
      expect(down.status).toBe(200);
      expect(down.body.state).toBe('TakenDown');
      await page.reload();
      await expect(page.getByRole('heading', { name: 'Me', level: 1 })).toBeVisible();
      await expect(card).toContainText(coach.name);
      await expect(card.locator('[data-coach-line]', { hasText: line.what })).toHaveCount(0);
    } finally {
      if (line) await putAway(admin, line);
      await admin.context().close();
    }
  });

  test('the coach switches the line off on their Certificates page, and Me stops showing it', async ({
    page,
    browser,
  }) => {
    test.setTimeout(240_000);
    await signIn(page, CLIENT);
    const admin = await deskPage(browser);
    const desk = await deskPage(browser);
    let line: RecordedLine | null = null;
    try {
      await signIn(admin, ADMIN_EMAIL!, ADMIN_PASSWORD!);
      const coach = await clientsCoach(page, admin);
      line = await confirmLine(admin, await recordLine(admin, coach));
      const card = await openMe(page, coach);
      await expect(card.locator('[data-coach-line]', { hasText: line.what })).toHaveText(line.text);

      // The coach, at a desk: their own page lists the line, shown, with its switch.
      await signIn(desk, coach.email);
      expect((await memberships(desk))[0].tenantId, 'the coach opens the client’s space').toBe(
        coach.tenantId,
      );
      await desk.goto('/account/certificates');
      await expect(desk.getByRole('heading', { name: 'Certificates', level: 1 })).toBeVisible();
      const row = desk.locator(`li.line[data-line="${line.id}"]`);
      await expect(row.locator('[data-sentence]')).toHaveText(line.text);
      await expect(row.locator('app-status-pill')).toHaveText('Shown to clients');
      const box = row.getByRole('checkbox', { name: 'Show to my clients' });
      await expect(box).toBeChecked();

      // Off, straight after signing in: the page fetches a fresh token first, so the switch saves.
      const lineId = line.id;
      const [answer] = await Promise.all([
        desk.waitForResponse(
          (response) =>
            response.request().method() === 'PUT' &&
            new URL(response.url()).pathname === `/api/coach-certificates/me/${lineId}/shown`,
        ),
        box.click(),
      ]);
      expect(answer.status()).toBe(200);
      await expect(row.locator('app-status-pill')).toHaveText('Hidden');
      await expect(box).not.toBeChecked();
      await expect(row.getByRole('alert')).toHaveCount(0);

      // The client's Me after a reload: the line is gone, the coach's card stays.
      await page.reload();
      await expect(page.getByRole('heading', { name: 'Me', level: 1 })).toBeVisible();
      await expect(card).toContainText(coach.name);
      await expect(card.locator('[data-coach-line]', { hasText: line.what })).toHaveCount(0);

      // The admin's sheet says what a client sees of it.
      await admin.goto('/admin/coaches');
      await admin
        .locator(`li.coach[data-coach="${coach.userId}"][data-space="${coach.tenantId}"]`)
        .getByRole('button', { name: coach.name })
        .click();
      const sheet = admin.getByRole('dialog', { name: coach.name, exact: true });
      await expect(sheet.locator(`[data-line="${line.id}"] app-status-pill`)).toHaveText(
        'Hidden by the coach',
      );
    } finally {
      if (line) await putAway(admin, line);
      await admin.context().close();
      await desk.context().close();
    }
  });
});
