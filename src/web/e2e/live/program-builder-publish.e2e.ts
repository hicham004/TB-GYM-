import type { Locator, Page } from '@playwright/test';
import { ACCOUNTS, expect, requireLive, signIn, test } from './support';
import { chooseOption } from '../kit-controls';

/**
 * The program builder against the real API (C4, ADR 0033, TRN-024, TRN-025): Karim builds a program from a
 * dragged exercise, prescribes a chart-loaded set, copies the week with a progression, hides a week from the
 * client, publishes, and a second tab is told to reload when it falls behind. Every run creates its own
 * program, so a rebuilt demo runs it again.
 */
requireLive();

test.describe.configure({ mode: 'serial' });

const programName = `Live builder ${Date.now().toString(36)}`;
let programUrl = '';

/** A drag the way a hand makes it: press, move past the CDK's threshold, travel, settle, release. */
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

/** Waits for the next draft save to reach the server (the status may already read "Saved at"). */
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

test('a coach drags, prescribes, copies with a progression and publishes', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, ACCOUNTS.owner);

  await page.goto('/training/programs/new');
  await expect(page.locator('section.week').first()).toBeVisible();
  await expect(page.locator('.status')).toHaveText('Your changes save as you work');
  await nextSave(page, () => page.getByLabel('Program name').fill(programName));
  await expect(page).toHaveURL(/\/training\/programs\/new\?draft=/);

  // The library starts as a rail; open, drag Back Squat into the first day's session.
  await page.locator('.library-rail').click();
  await expect(page.locator('app-program-library')).toBeVisible();
  const week1 = page.locator('section.week').first();
  const session = week1.locator('.session-card').first();
  await nextSave(page, () =>
    drag(
      page,
      page.locator('app-program-library .lib-item', { hasText: 'Back Squat' }).first(),
      session.locator('.exercise-list'),
    ),
  );
  await expect(session.locator('.exercise-name')).toHaveText([/Back Squat/]);

  // One set, 5 reps, loaded from the RTS chart at RPE 8; RPE 6 is outside the chart and says so.
  const row = session.locator('.exercise-row').first();
  await row.getByRole('button', { name: 'Edit sets for Back Squat' }).click();
  const inline = row.locator('.inline-sets');
  await inline.getByRole('button', { name: 'No prescribed load', exact: true }).click();
  await page.getByRole('button', { name: 'RPE · RTS chart', exact: true }).click();
  const rpe = inline.getByRole('spinbutton', { name: 'RPE target', exact: true });
  await rpe.fill('6');
  await rpe.press('Tab');
  await expect(inline.locator('app-field', { hasText: 'RPE target' })).toContainText(
    'the RTS chart starts at RPE 6.5',
  );
  await nextSave(page, async () => {
    await rpe.fill('8');
    await rpe.press('Tab');
  });
  await expect(row.locator('.exercise-line')).toHaveText('1 × 5 · RPE 8');
  await row.getByRole('button', { name: 'Done editing sets' }).click();

  // Duplicate with progression: two copies, half an RPE point each, read before they are added.
  await week1.getByRole('button', { name: 'More for week 1' }).click();
  await page.getByRole('button', { name: 'Duplicate with progression…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Duplicate with progression' });
  await dialog.getByRole('spinbutton', { name: 'Copies' }).fill('2');
  await chooseOption(dialog, 'RPE a week', '+0.5 a week');
  await dialog.getByRole('button', { name: 'Show the new weeks' }).click();
  await expect(
    dialog.getByRole('heading', { name: '2 new weeks after week 1', level: 3 }),
  ).toBeVisible();
  await expect(dialog.locator('.result')).toContainText(
    '5 · Load from RTS chart & effort · RPE 8.5',
  );
  await expect(dialog.locator('.result')).toContainText('5 · Load from RTS chart & effort · RPE 9');
  await expect(page.locator('section.week')).toHaveCount(1);
  await nextSave(page, () => dialog.getByRole('button', { name: 'Add 2 weeks' }).click());
  await expect(page.locator('section.week')).toHaveCount(3);
  await expect(page.locator('section.week').nth(2).locator('.exercise-line')).toHaveText([
    '1 × 5 · RPE 9',
  ]);

  // Week 3 stays unshared: the preview hides it and shows no calculated kilograms.
  await nextSave(page, () =>
    page
      .locator('section.week')
      .nth(2)
      .getByRole('checkbox', { name: 'Shared with client' })
      .uncheck(),
  );
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  const preview = page.getByRole('dialog', { name: 'Preview before publishing' });
  await expect(preview).toBeVisible();
  await expect(preview).toContainText('Load from RTS chart & effort · RPE 8');
  await expect(preview).not.toContainText(' kg');
  await preview.getByText('Week 3', { exact: true }).click({ force: true });
  await expect(preview).toContainText('Your coach hasn’t shared this week yet');
  await preview.getByRole('button', { name: 'Publish program', exact: true }).click();
  await expect(page.getByText('Published. You can assign it to clients now.')).toBeVisible({
    timeout: 20_000,
  });
  await expect(page).toHaveURL(/\/training\/programs\/(?!new)[0-9a-f-]+$/);
  await expect(page.locator('.status')).toHaveText('Published: you can assign it');
  programUrl = new URL(page.url()).pathname;

  await page.getByRole('button', { name: 'Versions' }).click();
  await expect(page.getByRole('dialog').locator('.history-row')).toHaveCount(1);
  await expect(page.getByRole('dialog').locator('.history-row').first()).toContainText('Version 1');
  await page.keyboard.press('Escape');

  await page.goto('/training/programs');
  await expect(page.locator('.cards .card', { hasText: programName })).toContainText(
    'Ready to assign',
  );
});

test('a second tab that saves later makes the first reload, and Discard brings back the published program', async ({
  page,
  context,
}) => {
  test.skip(!programUrl, 'The first test publishes the program this one edits.');
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, ACCOUNTS.owner);
  await page.goto(programUrl);
  await expect(page.locator('section.week').first()).toBeVisible();
  await nextSave(page, () => page.getByLabel('Description').fill('Changed in the first tab.'));

  const second = await context.newPage();
  await second.goto(programUrl);
  await expect(second.locator('section.week').first()).toBeVisible();
  await expect(second.getByLabel('Description')).toHaveValue('Changed in the first tab.');
  await nextSave(second, () => second.getByLabel('Description').fill('Changed in the second tab.'));

  await page.getByLabel('Description').fill('Changed again in the first tab.');
  await expect(page.locator('.status')).toHaveText('Not saved', { timeout: 20_000 });
  await expect(page.getByRole('alert')).toContainText(
    'This program was changed in another tab or on another device. Reload to continue with the latest changes.',
  );
  await page.getByRole('button', { name: 'Reload' }).click();
  await expect(page.getByLabel('Description')).toHaveValue('Changed in the second tab.');
  await second.close();

  await page.getByRole('button', { name: 'Discard changes' }).click();
  const confirm = page.getByRole('dialog');
  await expect(confirm).toContainText('The program goes back to how it was last published.');
  await confirm.getByRole('button', { name: 'Discard changes' }).click();
  await expect(page.getByText('Changes discarded.')).toBeVisible();
  await expect(page.getByLabel('Description')).toHaveValue('');
  await expect(page.locator('.status')).toHaveText('Published: you can assign it');
});
