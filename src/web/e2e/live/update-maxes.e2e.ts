import type { Page } from '@playwright/test';
import { ACCOUNTS, expect, requireLive, signIn, test } from './support';

/**
 * Training maxes on a running program against the real API (P2, STR-002, STR-009, STR-011): Lea types a new
 * Back Squat max for Maya Fakhoury, 2.5 kg above the one in use, reads every changed weight with its working-out
 * before anything is saved, applies it, and the panel shows the new max with the old one in its history. Typing
 * the max, rather than taking the logged-set suggestion, keeps the spec runnable on any copy of the demo and
 * again on the same one (each run adds 2.5 kg).
 */
requireLive();

const fmt = (value: number): string => Number(value.toFixed(3)).toString();

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

test('Lea types a new training max for Maya, reviews every changed weight, then applies it', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, ACCOUNTS.coachLea);
  const mayaId = await clientIdOf(page, 'Maya Fakhoury');
  await page.goto(`/clients/${mayaId}/training`);
  const panel = page.locator('app-program-maxes');
  await expect(panel.locator('.lift').first()).toBeVisible({ timeout: 20_000 });
  test.skip(
    (await panel.locator('.foot .note').count()) > 0,
    'Maya’s program is over on this copy of the demo, so its maxes stay as they were.',
  );

  await page.getByRole('button', { name: 'Update maxes for the coming weeks' }).click();
  const sheet = page.getByRole('dialog', { name: 'Update training maxes' });
  const squat = sheet.locator('fieldset.lift', { hasText: 'Back Squat' });
  await expect(squat).toBeVisible({ timeout: 20_000 });
  const legend = await squat.locator('legend').innerText();
  const current = Number(/now ([\d.]+) kg/.exec(legend)![1]);
  expect(current).toBeGreaterThan(0);
  const next = current + 2.5;

  // Nothing is sent until a max has changed.
  await sheet.getByRole('button', { name: 'Show the new weights' }).click();
  await expect(sheet.getByRole('alert')).toHaveText('Change at least one training max.');

  await squat.getByLabel('New training max').fill(fmt(next));
  await sheet.getByLabel('Why? (optional)').fill('Live check: a typed max');
  await sheet.getByRole('button', { name: 'Show the new weights' }).click();
  await expect(sheet.locator('.lift-changes li')).toHaveCount(1, { timeout: 20_000 });
  await expect(sheet.locator('.lift-changes li').first()).toContainText('Back Squat');
  await expect(sheet.locator('.lift-changes li').first()).toContainText(
    `${fmt(current)} kg to ${fmt(next)} kg`,
  );
  await expect(sheet.locator('.line.strong')).toHaveText(
    /^(\d+ weights? change in \d+ sessions?\.|No session still to come uses this max.*|Once rounded, the new max gives the same weights as before\.)/,
  );
  await expect(sheet).toContainText('Reason: Live check: a typed max');
  // Every changed set is worked out from the new max, and says so.
  const how = sheet.locator('.how');
  if (await how.count()) {
    await how.first().locator('summary').click();
    await expect(how.first().locator('p')).toContainText(`${fmt(next)} kg`);
  }

  await sheet.getByRole('button', { name: 'Update maxes', exact: true }).click();
  await expect(
    page
      .getByRole('status')
      .filter({ hasText: 'Training maxes updated. The weeks still to come follow them.' }),
  ).toBeVisible({ timeout: 20_000 });
  await expect(sheet).toHaveCount(0);

  const card = panel.locator('.lift', { hasText: 'Back Squat' });
  await expect(card.locator('.value')).toHaveText(`${fmt(next)} kg`, { timeout: 20_000 });
  await expect(card).toContainText('Typed by you');
  await expect(card).toContainText(`Up 2.5 kg from ${fmt(current)} kg`);
  await expect(card).toContainText('Earlier maxes');
});
