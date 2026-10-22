import type { Locator, Page } from '@playwright/test';
import { ACCOUNTS, api, expect, memberships, requireLive, signIn, test } from './support';
import { chooseDay, chooseOption } from '../kit-controls';

/**
 * Assign program against the real API (C3 Training, TRN-011, TRN-014, STR-010): Karim publishes a one-week
 * program whose only set is loaded from the RTS chart, then assigns it to Lynn Bou Khalil from today with a
 * typed training max and checks the calculated load by hand (5 reps at RPE 8 is 81.1 % of 100 kg = 81.1 kg,
 * rounded to the nearest 2.5 kg: 80 kg). When Lynn already has a program running or coming, the server must
 * refuse the overlap in words and create nothing; the spec asserts that path instead, so it runs on any copy
 * of the demo.
 */
requireLive();

interface Block {
  id: string;
  status: string;
  startDate: string;
  endDateExclusive: string;
  version: number | string;
}

async function drag(page: Page, from: Locator, to: Locator): Promise<void> {
  await from.scrollIntoViewIfNeeded();
  const start = await from.boundingBox();
  const end = await to.boundingBox();
  if (!start || !end) throw new Error('Both ends of the drag must be on screen.');
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(start.x + start.width / 2 + 8, start.y + start.height / 2 + 8, {
    steps: 4,
  });
  await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2, { steps: 16 });
  await page.mouse.move(end.x + end.width / 2 + 1, end.y + end.height / 2 + 1, { steps: 2 });
  await page.mouse.up();
}

async function nextSave(page: Page, action: () => Promise<void>): Promise<void> {
  const saved = page.waitForResponse(
    (response) =>
      response.url().includes('/api/training/program-drafts') &&
      response.request().method() !== 'GET' &&
      response.ok(),
    { timeout: 20_000 },
  );
  await action();
  await saved;
  await expect(page.locator('.status')).toHaveText(/^Saved at \d\d:\d\d, not published yet$/);
}

/** Builds and publishes a one-week program: Back Squat, 1 × 5 loaded from the RTS chart at RPE 8. */
async function publishProgram(page: Page, name: string): Promise<void> {
  await page.goto('/training/programs/new');
  await expect(page.locator('section.week').first()).toBeVisible();
  await nextSave(page, () => page.getByLabel('Program name').fill(name));
  if (!(await page.locator('app-program-library').count()))
    await page.locator('.library-rail').click();
  await expect(page.locator('app-program-library')).toBeVisible();
  const session = page.locator('section.week').first().locator('.session-card').first();
  await nextSave(page, () =>
    drag(
      page,
      page.locator('app-program-library .lib-item', { hasText: 'Back Squat' }).first(),
      session.locator('.exercise-list'),
    ),
  );
  const row = session.locator('.exercise-row').first();
  await row.getByRole('button', { name: 'Edit sets for Back Squat' }).click();
  const inline = row.locator('.inline-sets');
  await inline.getByRole('button', { name: 'No prescribed load', exact: true }).click();
  await page.getByRole('button', { name: 'RPE · RTS chart', exact: true }).click();
  const rpe = inline.getByRole('spinbutton', { name: 'RPE target', exact: true });
  await nextSave(page, async () => {
    await rpe.fill('8');
    await rpe.press('Tab');
  });
  await row.getByRole('button', { name: 'Done editing sets' }).click();
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  const preview = page.getByRole('dialog', { name: 'Preview before publishing' });
  await preview.getByRole('button', { name: 'Publish program', exact: true }).click();
  await expect(page.getByText('Published. You can assign it to clients now.')).toBeVisible({
    timeout: 20_000,
  });
}

/** The client's profile id, read from the address after opening them from the Clients list. */
async function clientIdOf(page: Page, fullName: string): Promise<string> {
  await page.goto('/clients');
  const row = page.getByText(fullName, { exact: true }).first();
  await expect(row).toBeVisible({ timeout: 20_000 });
  const box = await row.boundingBox();
  if (!box) throw new Error(`${fullName} is not on screen.`);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForURL(/\/clients\/[0-9a-f-]{36}/, { timeout: 20_000 });
  return /\/clients\/([0-9a-f-]{36})/.exec(new URL(page.url()).pathname)![1];
}

test('Karim assigns the program he just published to Lynn, or is refused in words when she already has one', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, ACCOUNTS.owner);
  const [{ tenantId }] = await memberships(page);
  const name = `Live assign ${Date.now().toString(36)}`;
  await publishProgram(page, name);

  const lynnId = await clientIdOf(page, 'Lynn Bou Khalil');
  const overview = await api<{ today: string }>(page, 'GET', `/api/clients/${lynnId}/overview`, {
    tenantId,
  });
  expect(overview.status).toBe(200);
  const today = overview.body.today;
  const programPath = `/api/training/clients/${lynnId}/program`;
  const before = await api<{ blocks: Block[] }>(page, 'GET', programPath, { tenantId });
  expect(before.status).toBe(200);
  const inTheWay = before.body.blocks.filter(
    (block) =>
      block.status !== 'Cancelled' &&
      block.status !== 'Completed' &&
      block.endDateExclusive > today,
  );

  await page.goto(`/clients/${lynnId}/training?action=assign`);
  const sheet = page.getByRole('dialog', { name: 'Assign program' });
  await expect(sheet).toBeVisible({ timeout: 20_000 });
  await chooseOption(sheet, 'Program', `${name} · 1 week`);
  await chooseDay(sheet, 'Start date', today);
  await expect(sheet.locator('.run')).toContainText(/Runs \w{3} \d/);
  const squat = sheet.locator('.max', { hasText: 'Back Squat' });
  await expect(squat).toBeVisible();
  await squat.getByRole('spinbutton').first().fill('100');
  await sheet.getByRole('button', { name: 'Assign program' }).click();

  if (inTheWay.length > 0) {
    // TRN-011: a second primary program may not overlap; the server names the block and the first free day.
    await expect(sheet.getByRole('alert')).toContainText(
      /already has .*or cancel that program first\./,
      {
        timeout: 20_000,
      },
    );
    const after = await api<{ blocks: Block[] }>(page, 'GET', programPath, { tenantId });
    expect(after.body.blocks).toHaveLength(before.body.blocks.length);
    return;
  }

  await expect(
    page.getByRole('status').filter({ hasText: `${name} is assigned to Lynn.` }),
  ).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.hero')).toContainText(name);
  await expect(page.locator('app-program-maxes')).toContainText('Back Squat');
  await expect(page.locator('app-program-maxes')).toContainText('100 kg');
  await expect(page.locator('app-program-maxes')).toContainText('Typed by you');

  // The one session's load, worked out from the typed max: 81.1 % of 100 kg → 80 kg at the nearest 2.5.
  await page.locator('.strip .week').first().locator('.session').first().click();
  const session = page.getByRole('dialog');
  await expect(session.locator('.exercises')).toContainText('80 kg · RPE 8', { timeout: 20_000 });
  await page.keyboard.press('Escape');

  const after = await api<{ blocks: Block[] }>(page, 'GET', programPath, { tenantId });
  expect(after.body.blocks).toHaveLength(before.body.blocks.length + 1);

  // Leave Lynn as the demo made her (no program), so the other live specs and the next run of this
  // one find the same client: the block this test assigned is cancelled with its reason on record.
  const assigned = after.body.blocks.find(
    (block) => !before.body.blocks.some((earlier) => earlier.id === block.id),
  );
  expect(assigned).toBeDefined();
  const cancelled = await api(page, 'POST', `/api/training/mesocycles/${assigned!.id}/cancel`, {
    tenantId,
    body: {
      reason: 'Live spec clean-up: this program was assigned by a test',
      version: assigned!.version,
    },
  });
  expect(cancelled.status).toBe(200);
});
