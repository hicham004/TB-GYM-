import type { Page } from '@playwright/test';
import { ACCOUNTS, api, expect, memberships, requireLive, signIn, test } from './support';

/**
 * Critique B16's small fixes against the real API. Lea adds to Maya's weeks with + and Add here, as the
 * builders do, and nothing is kept until it is applied; the label beside Maya's weight and "Since start"
 * read one figure from the server, in weekly means; and an uploaded video's tile and its card's menu open
 * the demo the builder's Watch demo opens, on a clip the page records and uploads, which really plays.
 * Each run reads its numbers from the server, so it passes on any copy of the demo.
 */
requireLive();

interface Client {
  id: string;
  firstName: string;
}

interface WeeklyChange {
  methodKey: string;
  methodVersion: string;
  fromDate: string;
  deltaKilograms: number | string;
  displayDelta: number | string;
}

interface Dashboard {
  from: string;
  bodyweight: {
    weeklyChange: WeeklyChange | null;
    start: {
      starts: { measurementDate: string }[];
      sinceStart: { deltaKilograms: number | string; displayDelta: number | string } | null;
    } | null;
  };
}

async function mayaId(page: Page, tenantId: string): Promise<string> {
  const listed = await api<Client[]>(page, 'GET', '/api/clients', { tenantId });
  const maya = listed.body.find((client) => client.firstName === 'Maya');
  if (!maya) throw new Error('Maya is not on this copy of the demo.');
  return maya.id;
}

/** A second of a canvas, recorded by the page and uploaded as a coach's own video. */
async function uploadClip(page: Page, title: string, tenantId: string): Promise<string> {
  return page.evaluate(
    async ({ title, tenantId }) => {
      const canvas = document.createElement('canvas');
      canvas.width = 160;
      canvas.height = 120;
      const paint = canvas.getContext('2d')!;
      const recorder = new MediaRecorder(canvas.captureStream(15), { mimeType: 'video/webm' });
      const chunks: Blob[] = [];
      recorder.ondataavailable = (event) => chunks.push(event.data);
      const stopped = new Promise((resolve) => (recorder.onstop = resolve));
      recorder.start();
      for (let frame = 0; frame < 20; frame++) {
        paint.fillStyle = frame % 2 ? '#2e6b4f' : '#d9ed94';
        paint.fillRect(0, 0, 160, 120);
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      recorder.stop();
      await stopped;
      const form = new FormData();
      form.append('title', title);
      form.append('file', new File(chunks, 'demo.webm', { type: 'video/webm' }), 'demo.webm');
      const csrf = await fetch('/api/auth/csrf', { credentials: 'same-origin' });
      const { token } = (await csrf.json()) as { token: string };
      const response = await fetch('/api/media/uploads', {
        method: 'POST',
        headers: { 'X-XSRF-TOKEN': token, 'X-Tenant-Id': tenantId },
        credentials: 'same-origin',
        body: form,
      });
      return ((await response.json()) as { id: string }).id;
    },
    { title, tenantId },
  );
}

test('Lea adds to Maya’s weeks with + and Add here, and no day gone offers one', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, ACCOUNTS.coachLea);
  const [{ tenantId }] = await memberships(page);
  const client = await mayaId(page, tenantId);
  const program = await api<{ blocks: { id: string; status: string }[] }>(
    page,
    'GET',
    `/api/training/clients/${client}/program`,
    { tenantId },
  );
  const running = program.body.blocks.find(
    (block) => block.status !== 'Cancelled' && block.status !== 'Completed',
  );
  test.skip(!running, 'Maya has no program running on this copy of the demo.');
  const version = async () =>
    (
      await api<{ version: number | string }>(
        page,
        'GET',
        `/api/training/mesocycles/${running!.id}`,
        { tenantId },
      )
    ).body.version;
  const before = await version();

  await page.goto(`/clients/${client}/training/${running!.id}/edit`);
  await expect(page.locator('#edit-title')).toHaveText('Edit weeks', { timeout: 20_000 });
  if (!(await page.locator('app-program-library').count()))
    await page.locator('.library-rail').click();
  const library = page.locator('app-program-library');
  await expect(library.locator('.lib-item').first()).toBeVisible({ timeout: 20_000 });
  await expect(library.locator('.help')).toHaveText(
    'Drag an exercise into a workout, or press + to add it.',
  );

  const row = library.locator('.lib-item', { hasText: 'Back Squat' }).first();
  await row.locator('.choose').click();
  await expect(page.locator('app-adding-bar .text')).toHaveText(
    'Adding Back Squat: press Add here where it goes.',
  );
  await expect(page.locator('.day.gone .add-here')).toHaveCount(0);

  await page.keyboard.press('Escape');
  await expect(page.locator('.add-here')).toHaveCount(0);
  await expect(row.locator('.choose')).toBeFocused();

  await row.locator('.choose').click();
  const workout = page.locator('.session-card:has(.add-here)').first();
  const name = (await workout.locator('.session-name').innerText()).trim();
  const lifts = await workout.locator('.exercise-row').count();
  await workout.locator('.add-here').click();
  await expect(page.locator('app-adding-bar')).toHaveCount(0);
  await expect(page.getByText(`Back Squat added to ${name}.`)).toBeVisible();
  await expect(page.locator('.status')).toHaveText('Changes not applied yet');

  await page.getByRole('button', { name: 'Review changes' }).click();
  const review = page.getByRole('dialog', { name: 'Review changes' });
  await expect(review.locator('.review-headline')).toContainText('1 workout changed');
  await review.getByRole('button', { name: 'Back to editing' }).click();

  // Nothing was applied, so the grid goes back and the server's program never moved.
  await page.getByRole('button', { name: 'Discard changes' }).click();
  await page
    .getByRole('dialog', { name: 'Discard your changes?' })
    .getByRole('button', { name: 'Discard changes' })
    .click();
  await expect(page.locator('.session-card').filter({ hasText: name }).first()).toBeVisible();
  await expect(page.locator('.status')).not.toHaveText('Changes not applied yet');
  expect(await page.locator('.session-card').first().locator('.exercise-row').count()).toBe(lifts);
  expect(await version()).toBe(before);
});

test('the label beside Maya’s weight and Since start read one figure, for her and for Lea', async ({
  page,
  browser,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, ACCOUNTS.coachLea);
  const [{ tenantId }] = await memberships(page);
  const client = await mayaId(page, tenantId);
  const dashboard = await api<Dashboard>(page, 'GET', `/api/progress/clients/${client}/dashboard`, {
    tenantId,
  });
  const { weeklyChange, start } = dashboard.body.bodyweight;
  test.skip(!weeklyChange || !start?.sinceStart, 'Maya has one week of weigh-ins on this copy.');
  const first = start!.starts[0].measurementDate;
  test.skip(first < dashboard.body.from, 'The chart does not reach Maya’s start on this copy.');

  // Named and versioned, and the same two weeks' difference as "Since start".
  expect([weeklyChange!.methodKey, weeklyChange!.methodVersion]).toEqual([
    'BodyweightChangeWeeklyMean',
    '1.0',
  ]);
  expect(Number(weeklyChange!.deltaKilograms)).toBe(Number(start!.sinceStart!.deltaKilograms));

  await page.goto(`/clients/${client}/progress`);
  const delta = page.locator('.hero-card .delta');
  await expect(delta).toContainText('since', { timeout: 20_000 });
  const size = /([\d.]+) kg since/.exec(await delta.innerText())![1];
  await expect(page.locator('.since-start')).toContainText(`${size} kg (`);
  const label = (await delta.innerText()).replace(/\s+/g, ' ').trim();

  // All reaches past the twelve months the read covers, so it says where the chart begins instead.
  await page.getByRole('button', { name: 'All', exact: true }).click();
  await expect(delta).toContainText('Recorded from');

  const context = await browser.newContext({ baseURL: page.url().split('/clients')[0] });
  const maya = await context.newPage();
  await signIn(maya, ACCOUNTS.maya);
  await maya.goto('/progress/dashboard');
  const own = maya.locator('.hero-card .delta');
  await expect(own).toContainText('since', { timeout: 20_000 });
  expect((await own.innerText()).replace(/\s+/g, ' ').trim()).toBe(label);
  await expect(maya.locator('[data-start]')).toHaveCount(0);
  await context.close();
});

test('an uploaded video’s tile and its card’s menu open the demo, and it plays', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, ACCOUNTS.owner);
  const [{ tenantId }] = await memberships(page);
  const name = `Live Lunge ${Date.now().toString(36)}`;
  const mediaId = await uploadClip(page, name, tenantId);
  const created = await api(page, 'POST', '/api/exercises', {
    tenantId,
    body: {
      name,
      instructions: null,
      equipment: 'Bodyweight',
      movementPattern: 'Locomotion',
      classification: 'Strength',
      typeName: null,
      muscles: [{ muscle: 'Quadriceps', role: 'Primary' }],
      tags: [],
      alternatives: [],
      mediaAssetIds: [mediaId],
    },
  });
  expect(created.status).toBe(200);

  await page.goto(`/training/exercises?q=${encodeURIComponent(name)}`);
  const card = page.locator('.exercise', { hasText: name });
  const tile = card.locator('app-exercise-demo button');
  await expect(tile).toHaveText('Watch demo', { timeout: 20_000 });

  const sheet = page.getByRole('dialog', { name });
  await tile.click();
  await expect(sheet.locator('video')).toBeVisible();
  await expect
    .poll(() => sheet.locator('video').evaluate((video: HTMLVideoElement) => video.readyState))
    .toBeGreaterThan(0);
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
  await expect(tile).toBeFocused();

  const more = page.getByRole('button', { name: `More for ${name}` });
  await more.click();
  const panel = page.locator('ul.panel');
  await expect(panel.locator('.item-title')).toHaveText(['Watch demo', 'Edit', 'Archive']);
  await panel.locator('.item', { hasText: 'Watch demo' }).click();
  await expect(sheet.locator('video')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);

  // Archived, it opens all the same, and the page says where Restore is.
  await more.click();
  await panel.locator('.item', { hasText: 'Archive' }).click();
  await page.getByRole('radio', { name: /^Archived \(/ }).check();
  await expect(page.locator('.archived-note')).toContainText('Restore one from its menu.');
  await expect(card.locator('.archived-tag')).toBeVisible();
  await expect(card.locator('app-exercise-demo button')).toBeVisible();
  await page.getByRole('button', { name: `More for ${name}` }).click();
  await expect(panel.locator('.item-title')).toHaveText(['Watch demo', 'Restore']);
});
