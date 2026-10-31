import type { Page } from '@playwright/test';
import { ACCOUNTS, api, expect, memberships, requireLive, signIn, test } from './support';

/**
 * The weight to lift against the real API (critique B15, STR-018): Lea opens Maya's Edit weeks, where a
 * lift worked out from a max reads the load the server saved, the weight Maya is given; a changed share
 * shows as the share until it is applied, and Discard changes brings the weight back with nothing saved.
 * A template has no client, so Karim's new program reads the Epley curve's share. Each run reads the
 * numbers from the server, so it passes on any copy of the demo with a workout still to come.
 */
requireLive();

interface SetView {
  loadStrategy: string;
  percentageWorkingMax: number | string | null;
  prescribedLoad: number | string | null;
  repetitionsMaximum: number | string | null;
  targetRpe: number | string | null;
  setType: string;
}

interface SessionView {
  name: string;
  hasStarted: boolean;
  scheduledDate: string | null;
  exercises: { exerciseName: string; sets: SetView[] }[];
}

interface MesocycleView {
  id: string;
  version: number | string;
  weeks: { weekNumber: number | string; sessions: SessionView[] }[];
}

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

test('Lea reads Maya’s saved weights in Edit weeks, and a changed set’s share until it is applied', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, ACCOUNTS.coachLea);
  const [{ tenantId }] = await memberships(page);
  const mayaId = await clientIdOf(page, 'Maya Fakhoury');
  const program = await api<{ localDate: string; blocks: { id: string; status: string }[] }>(
    page,
    'GET',
    `/api/training/clients/${mayaId}/program`,
    { tenantId },
  );
  expect(program.status).toBe(200);
  const running = program.body.blocks.find(
    (block) => block.status !== 'Cancelled' && block.status !== 'Completed',
  );
  test.skip(!running, 'Maya has no program running on this copy of the demo.');
  const read = async () =>
    (await api<MesocycleView>(page, 'GET', `/api/training/mesocycles/${running!.id}`, { tenantId }))
      .body;
  const before = await read();

  // The first lift still to come whose sets all work their weight out as a share of the max.
  const today = program.body.localDate;
  const places = before.weeks.flatMap((week, weekIndex) =>
    week.sessions
      .filter((session) => !session.hasStarted && (session.scheduledDate ?? '') >= today)
      .flatMap((session) =>
        session.exercises.map((exercise) => ({ weekIndex, session, exercise })),
      ),
  );
  const place = places.find(({ exercise }) =>
    exercise.sets.every((set) => set.loadStrategy === 'PercentageWorkingMax'),
  );
  test.skip(!place, 'No % set is still to come in Maya’s program on this copy of the demo.');
  const { weekIndex, session, exercise } = place!;
  const [first] = exercise.sets;
  const load = Number(first.prescribedLoad);
  const share = Number(first.percentageWorkingMax);
  expect(load).toBeGreaterThan(0);

  await page.goto(`/clients/${mayaId}/training/${running!.id}/edit`);
  await expect(page.locator('#edit-title')).toHaveText('Edit weeks', { timeout: 20_000 });
  const row = page
    .locator('section.week')
    .nth(weekIndex)
    .locator('.session-card', { hasText: session.name })
    .first()
    .locator('.exercise-row', { hasText: exercise.exerciseName })
    .first();
  const reps = Number(first.repetitionsMaximum);
  const rpe = Number(first.targetRpe);
  const weight = `${exercise.sets.length} × ${reps} · ${load} kg · RPE ${rpe}`;
  await expect(row.locator('app-set-lines .run')).toHaveText([weight]);

  // The set editor keeps the share; a new share shows as a share until it is applied.
  await row
    .getByRole('button', { name: `Edit sets for ${exercise.exerciseName}`, exact: true })
    .click();
  const inline = row.locator('.inline-sets');
  const changed = share + 2.5;
  await inline
    .getByRole('spinbutton', { name: '% of training max', exact: true })
    .fill(`${changed}`);
  await expect(page.locator('.status')).toHaveText('Changes not applied yet');
  await expect(row.locator('app-set-lines .run').first()).toHaveText(
    `1 × ${reps} · ${changed}% of training max · RPE ${rpe}`,
  );

  // Nothing was kept, so the weight comes back and the server's program never moved.
  await page.getByRole('button', { name: 'Discard changes' }).click();
  await page
    .getByRole('dialog', { name: 'Discard your changes?' })
    .getByRole('button', { name: 'Discard changes' })
    .click();
  await expect(row.locator('app-set-lines .run')).toHaveText([weight]);
  const after = await read();
  expect(after.version).toBe(before.version);
});

test('Karim’s template shows the Epley curve’s share, since a template has no client', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, ACCOUNTS.owner);
  await page.goto('/training/programs/new');
  await expect(page.locator('section.week').first()).toBeVisible({ timeout: 20_000 });
  await page.getByLabel('Program name').fill(`Live Epley ${Date.now().toString(36)}`);

  // The library's + and the week's first free spot, as a coach without a mouse adds a lift.
  if (!(await page.locator('app-program-library').count()))
    await page.locator('.library-rail').click();
  const library = page.locator('app-program-library');
  await expect(library).toBeVisible();
  await library.locator('.lib-item', { hasText: 'Back Squat' }).first().locator('.choose').click();
  const session = page.locator('section.week').first().locator('.session-card').first();
  await session.getByRole('button', { name: /^Add here/ }).click();

  const row = session.locator('.exercise-row').first();
  await row.getByRole('button', { name: 'Edit sets for Back Squat', exact: true }).click();
  const inline = row.locator('.inline-sets');
  await inline.getByRole('button', { name: 'No prescribed load', exact: true }).click();
  await page.getByRole('button', { name: 'RPE · Epley curve', exact: true }).click();
  await inline.getByRole('spinbutton', { name: 'RPE target', exact: true }).fill('8');

  await expect(row.locator('app-set-lines .run')).toHaveText([
    '1 × 5 · RPE 8 · 81% of training max',
  ]);
  await expect(inline).toContainText('Epley curve: 5 reps at RPE 8 is 81.1% of the training max.');
  await inline.getByRole('textbox', { name: 'Reps', exact: true }).fill('11');
  await expect(row.locator('app-set-lines .run')).toHaveText([
    '1 × 11 · RPE 8 · outside the Epley curve',
  ]);
});
