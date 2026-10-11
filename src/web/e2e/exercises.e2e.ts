import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import type { ExerciseView } from '../src/app/core/api/generated';
import {
  access,
  asset,
  BACK_SQUAT,
  BENCH_PRESS,
  exercise,
  PULL_UP,
} from '../src/testing/exercise-fixtures';
import {
  expect,
  expectNoHorizontalOverflow,
  json,
  mockSession,
  OWNER_MEMBERSHIP,
  test,
  useRtl,
  waitForFonts,
} from './support';

/**
 * The exercise library (C10, R5.1b): cards or a list, filter chips kept in the address, quick add
 * with a video link, and archive with Undo. Every API call is answered here; the guards, the tenant
 * header and the antiforgery flow run unchanged.
 */
const LIBRARY: ExerciseView[] = [
  BACK_SQUAT,
  BENCH_PRESS,
  PULL_UP,
  exercise('Romanian Deadlift', {
    movementPattern: 'Hinge',
    muscles: [{ muscle: 'Hamstrings', role: 'Primary' }],
    tags: ['hinge'],
  }),
  exercise('Kettlebell Swing', {
    equipment: 'Kettlebell',
    movementPattern: 'Hinge',
    classification: 'Conditioning',
    muscles: [{ muscle: 'Glutes', role: 'Primary' }],
  }),
  exercise('Half-kneeling Single-arm Landmine Press With A Long Name', {
    movementPattern: 'VerticalPush',
    muscles: [{ muscle: 'Shoulders', role: 'Primary' }],
  }),
];

async function openLibrary(
  page: Page,
  width: number,
  options: { dark?: boolean; url?: string } = {},
) {
  await page.emulateMedia({ colorScheme: options.dark ? 'dark' : 'light' });
  await page.setViewportSize({ width, height: 900 });
  const searches: URL[] = [];
  const writes: { url: string; body: unknown }[] = [];
  let csrfReads = 0;
  await mockSession(page, {
    extra: {
      'GET /api/auth/csrf': (route) => {
        csrfReads++;
        return json(route, 200, { token: 'e2e-csrf' });
      },
      'GET /api/exercises': (route) => {
        const url = new URL(route.request().url());
        searches.push(url);
        const pattern = url.searchParams.get('movementPattern');
        const items = pattern
          ? LIBRARY.filter((item) => item.movementPattern === pattern)
          : LIBRARY;
        return json(route, 200, { total: items.length, items });
      },
      'GET /api/media': (route) =>
        json(route, 200, {
          total: 2,
          skip: 0,
          take: 100,
          items: [
            asset({}),
            asset({
              id: 'm-bench-link',
              kind: 'Video',
              source: 'ExternalEmbed',
              externalProvider: 'YouTube',
            }),
          ],
        }),
      'POST /api/media/access': (route) => {
        expect(csrfReads).toBeGreaterThan(0);
        return json(route, 200, { items: [access({ url: '/favicon.ico' })] });
      },
      'POST /api/media/external': (route) => {
        writes.push({ url: route.request().url(), body: route.request().postDataJSON() });
        return json(route, 200, asset({ id: 'm-link', kind: 'Video', source: 'ExternalEmbed' }));
      },
      'POST /api/exercises': (route) => {
        expect(route.request().headers()['x-tenant-id']).toBe(OWNER_MEMBERSHIP.tenantId);
        const body = route.request().postDataJSON() as { name: string };
        writes.push({ url: route.request().url(), body });
        return json(route, 200, exercise(body.name, { mediaAssetIds: ['m-link'] }));
      },
      'PUT /api/exercises/ex-back-squat/archive': (route) => {
        const body = route.request().postDataJSON() as { isArchived: boolean };
        writes.push({ url: route.request().url(), body });
        return json(route, 200, { ...BACK_SQUAT, isArchived: body.isArchived, version: 9 });
      },
    },
  });
  await page.goto(options.url ?? '/training/exercises');
  await expect(page.getByRole('heading', { name: 'Exercises', exact: true })).toBeVisible();
  await page.locator('.exercise').first().waitFor();
  await waitForFonts(page);
  return { searches, writes };
}

async function axe(page: Page) {
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
    .analyze();
  expect(
    result.violations.map(
      (violation) =>
        `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).join(', ')}`,
    ),
  ).toEqual([]);
}

test('an exercise sheet protects edits on browser navigation and refresh', async ({ page }) => {
  await openLibrary(page, 390);
  await page.route('**/api/training/templates?*', (route) =>
    json(route, 200, { total: 0, items: [] }),
  );
  await page.route('**/api/training/program-drafts', (route) => json(route, 200, []));
  await page.getByRole('link', { name: 'Programs', exact: true }).click();
  await page.getByRole('link', { name: 'Exercises', exact: true }).click();
  await page.getByRole('button', { name: 'New exercise', exact: true }).click();
  await page.getByLabel('Exercise name').fill('Hip Thrust');
  // A refresh is a real browser action: refusing the native warning keeps both the page and entry.
  let refreshWarned = false;
  page.once('dialog', async (dialog) => {
    refreshWarned = dialog.type() === 'beforeunload';
    await dialog.dismiss();
  });
  await page.reload({ timeout: 5000 }).catch(() => undefined);
  expect(refreshWarned).toBe(true);
  await expect(page.getByLabel('Exercise name')).toHaveValue('Hip Thrust');
  await page.goBack();
  const warning = page.getByRole('dialog', { name: 'Close without saving?' });
  await warning.getByRole('button', { name: 'Keep editing' }).click();
  await expect(page).toHaveURL('/training/exercises');
  await expect(page.getByLabel('Exercise name')).toHaveValue('Hip Thrust');
  await expectNoHorizontalOverflow(page);
  await page
    .getByRole('dialog', { name: 'New exercise', exact: true })
    .getByRole('button', { name: 'Not now', exact: true })
    .click();
  await warning.getByRole('button', { name: 'Close without saving' }).click();
  await page.getByRole('link', { name: 'Programs', exact: true }).click();
  await expect(page).toHaveURL('/training/programs');
});

for (const width of [390, 1440]) {
  test(`the library shows cards and a list at ${width}px and passes axe`, async ({ page }) => {
    await openLibrary(page, width);
    await expect(page.locator('.lede')).toHaveText('6 exercises');
    await expect(page.locator('.exercise').first().locator('img')).toBeVisible();
    await expect(page.locator('.exercise').nth(1).locator('.play')).toHaveText('Video link');
    await expect(page.locator('.exercise').nth(2).locator('.initials')).toHaveText('PU');
    await expectNoHorizontalOverflow(page);
    await axe(page);
    await page.screenshot({ path: `test-results/r51b-library-${width}.png`, fullPage: true });

    await page.getByRole('button', { name: 'List', exact: true }).click();
    await expect(page).toHaveURL(/view=list/);
    await expect(page.locator('.exercises')).toHaveClass(/as-list/);
    await expectNoHorizontalOverflow(page);
    await axe(page);
  });

  test(`a chip filters at once and lives in the address at ${width}px`, async ({ page }) => {
    const { searches } = await openLibrary(page, width);
    await page.getByRole('button', { name: 'Pattern', exact: true }).click();
    await page.getByRole('button', { name: 'Hinge', exact: true }).click();
    await expect(page).toHaveURL(/pattern=Hinge/);
    await expect(page.locator('.exercise .name')).toHaveText([
      'Romanian Deadlift',
      'Kettlebell Swing',
    ]);
    expect(searches.at(-1)?.searchParams.get('movementPattern')).toBe('Hinge');
    await expect(page.getByRole('button', { name: 'Pattern: Hinge' })).toHaveClass(/selected/);
    await axe(page);
  });

  test(`every chip's list fits on screen at ${width}px`, async ({ page }) => {
    await openLibrary(page, width);
    for (const chip of ['Muscle', 'Pattern', 'Type', 'Equipment']) {
      await page.getByRole('button', { name: chip, exact: true }).click();
      await expect(page.locator('.panel')).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await page.keyboard.press('Escape');
    }
  });

  test(`New exercise adds a video link with the exercise at ${width}px`, async ({ page }) => {
    const { writes } = await openLibrary(page, width);
    await page.getByRole('button', { name: 'New exercise', exact: true }).click();
    const sheet = page.getByRole('dialog');
    await sheet.getByLabel('Exercise name').fill('Hip Thrust');
    await sheet.getByLabel('Video link (optional)').fill('https://youtu.be/dQw4w9WgXcQ');
    await expect(sheet).toContainText('YouTube video found.');
    await expectNoHorizontalOverflow(page);
    await axe(page);
    await sheet.getByRole('button', { name: 'Add exercise' }).click();
    await expect(sheet).toHaveCount(0);
    await expect(page.getByText('Hip Thrust is in your library.')).toBeVisible();
    expect(writes.map((write) => new URL(write.url).pathname)).toEqual([
      '/api/media/external',
      '/api/exercises',
    ]);
    expect((writes[1].body as { mediaAssetIds: string[] }).mediaAssetIds).toEqual(['m-link']);
  });

  test(`archiving says programs keep it, with Undo, at ${width}px`, async ({ page }) => {
    const { writes } = await openLibrary(page, width);
    await page.getByRole('button', { name: 'More for Back Squat' }).click();
    await page
      .locator('.panel .item')
      .filter({ hasText: /^Archive/ })
      .click();
    await expect(
      page.getByText('Back Squat is archived. Programs already built keep it.'),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(page.getByText('Back Squat is back in your library.')).toBeVisible();
    expect(writes.map((write) => write.body)).toEqual([
      { isArchived: true, version: 3 },
      { isArchived: false, version: 9 },
    ]);
  });

  test(`the library reflows with 200% text, dark and RTL at ${width}px`, async ({ page }) => {
    await openLibrary(page, width, { dark: true });
    await useRtl(page);
    await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
    await expectNoHorizontalOverflow(page);
    // Each chip's list fits on screen, the last ones opening from their other edge.
    for (const chip of ['Muscle', 'Pattern', 'Type', 'Equipment']) {
      await page.getByRole('button', { name: chip, exact: true }).click();
      await expect(page.locator('.panel')).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await page.keyboard.press('Escape');
    }
    await axe(page);
  });
}
