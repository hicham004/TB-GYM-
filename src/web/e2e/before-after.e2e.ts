import AxeBuilder from '@axe-core/playwright';
import type { Page, Route } from '@playwright/test';
import { workspace } from '../src/testing/intake-fixtures';
import {
  mayaPhotos,
  mayaWeighIns,
  NOW,
  photo,
  photosView,
  progressView,
} from '../src/testing/progress-fixtures';
import type { ProgressPhoto } from '../src/app/features/progress/progress.models';
import {
  expect,
  expectNoHorizontalOverflow,
  json,
  mockSession,
  OWNER_MEMBERSHIP,
  SIGNED_IN_USER,
  test,
  useRtl,
  waitForFonts,
} from './support';

/**
 * A client's before-and-after (R6.1b, M9) in a real browser: chosen on Your entries, named in a
 * confirmation, recorded by the server (PRG-013) and only then made on the page as a picture. The
 * server is a per-test mock that records what it was asked; the picture is the browser's own.
 */
const CLIENT = { ...OWNER_MEMBERSHIP, role: 'Client' };
const MAYA = { ...SIGNED_IN_USER, displayName: 'Maya Rahman', preferredWeightUnit: 'Kilogram' };
const FEATURES = ['Training', 'Nutrition', 'CheckIns', 'Messaging'];

/** A small drawn stand-in, plainly not a real person, 3:4 like a phone's photo. */
const PICTURE = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="400" viewBox="0 0 300 400"><rect width="300" height="400" fill="#d7e2cf"/><circle cx="150" cy="110" r="40" fill="#5c6862"/><rect x="95" y="160" width="110" height="200" rx="44" fill="#5c6862"/></svg>`;

interface Asked {
  exports: unknown[];
  order: string[];
}

interface Options {
  width?: number;
  dark?: boolean;
  /** The server refuses the export: one of the photos was removed meanwhile. */
  refuse?: boolean;
}

function photos(): ProgressPhoto[] {
  return [
    ...mayaPhotos(),
    photo({ pose: 'Front', photoDate: '2026-07-04' }),
    photo({ pose: 'Side', photoDate: '2026-08-01' }),
  ];
}

async function openPhotos(page: Page, options: Options = {}): Promise<Asked> {
  await page.clock.setFixedTime(new Date(NOW));
  await page.emulateMedia({ colorScheme: options.dark ? 'dark' : 'light' });
  await page.setViewportSize({
    width: options.width ?? 390,
    height: (options.width ?? 390) === 390 ? 844 : 900,
  });
  const asked: Asked = { exports: [], order: [] };
  const all = photos();
  const extra: Record<string, (route: Route) => Promise<void> | void> = {
    'GET /api/client-access/me': (route) =>
      json(
        route,
        200,
        FEATURES.map((feature) => ({ feature, isAllowed: true, reason: 'Granted' })),
      ),
    'GET /api/workspace': (route) => json(route, 200, workspace()),
    'GET /api/progress/me': (route) => json(route, 200, progressView(mayaWeighIns())),
    'GET /api/progress/me/span': (route) =>
      json(route, 200, { firstDate: '2026-10-05', lastDate: null }),
    'GET /api/progress/me/photos': (route) => json(route, 200, photosView(all)),
    'POST /api/media/access': (route) => {
      const ids = (route.request().postDataJSON() as { assetIds: string[] }).assetIds;
      asked.order.push(`grant ${ids.join(' ')}`);
      return json(route, 200, {
        items: ids.map((assetId) => ({
          assetId,
          kind: 'Image',
          source: 'Upload',
          contentType: 'image/svg+xml',
          url: `/api/media/${assetId}/content`,
          expiresAtUtc: '2026-10-10T10:00:00Z',
          downloadAllowed: false,
          thumbnailUrl: `/api/media/${assetId}/content/thumbnail`,
        })),
      });
    },
    'POST /api/progress/me/photo-exports': (route) => {
      const body = route.request().postDataJSON() as {
        beforePhotoId: string;
        afterPhotoId: string;
      };
      asked.exports.push(body);
      asked.order.push('export');
      if (options.refuse) {
        return json(route, 409, {
          code: 'ProgressPhotoRemoved',
          title: 'A removed photo cannot be used. Choose another.',
        });
      }
      const before = all.find((item) => item.id === body.beforePhotoId)!;
      const after = all.find((item) => item.id === body.afterPhotoId)!;
      const view = (item: ProgressPhoto) => ({
        id: item.id,
        photoDate: item.photoDate,
        mediaAssetId: item.mediaAssetId,
      });
      return json(route, 200, {
        id: `export-${asked.exports.length}`,
        pose: before.pose,
        before: view(before),
        after: view(after),
        exportedAtUtc: NOW,
      });
    },
  };
  for (const item of all) {
    for (const path of ['content', 'content/thumbnail']) {
      extra[`GET /api/media/${item.mediaAssetId}/${path}`] = (route) =>
        route.fulfill({ status: 200, contentType: 'image/svg+xml', body: PICTURE });
    }
  }

  await mockSession(page, { memberships: [CLIENT], user: MAYA, extra });
  await page.goto('/progress?tab=photos');
  await expect(page.getByRole('heading', { name: 'Your entries', level: 1 })).toBeVisible();
  await waitForFonts(page);
  return asked;
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

/** The picture the sheet shows, as the browser decoded it. */
async function pictureSize(page: Page) {
  const picture = page.locator('.tb-modal-pane--sheet .preview img');
  await expect(picture).toBeVisible();
  return picture.evaluate((image: HTMLImageElement) =>
    image.decode().then(() => ({ width: image.naturalWidth, height: image.naturalHeight })),
  );
}

/** A phone's share sheet as the page sees it: it takes pictures and keeps what it was handed. */
function phoneShareSheet() {
  Object.assign(navigator, {
    canShare: (data?: ShareData) => Boolean(data?.files?.length),
    share: async (data: ShareData) => {
      (window as unknown as { shared: unknown }).shared = (data.files ?? []).map((file) => ({
        name: file.name,
        type: file.type,
      }));
    },
  });
}

test('a phone makes a before and after: named first, recorded, then made and shared', async ({
  page,
}) => {
  await page.addInitScript(phoneShareSheet);
  const asked = await openPhotos(page);

  await page.getByRole('button', { name: 'Share a before and after' }).click();
  const sheet = page.getByRole('dialog', { name: 'Before and after' });
  await expect(sheet.getByRole('heading', { name: 'Choose your photos' })).toBeVisible();
  // The first front photo and the latest, with the time between them.
  await expect(sheet.locator('[data-slot="before"]')).toContainText('Sat 4 Jul 2026');
  await expect(sheet.locator('[data-slot="after"]')).toContainText('Sat 3 Oct 2026');
  await expect(sheet.locator('.apart')).toHaveText('13 weeks between them');
  await page.waitForTimeout(600);
  await axe(page);
  await page.screenshot({ path: 'test-results/r61b-pick-390.png' });

  await sheet.locator('[data-slot="before"]').click();
  await expect(sheet.getByRole('heading', { name: 'Choose your before photo' })).toBeVisible();
  await expect(sheet.locator('[data-photo="photo-Front-2026-10-03"]')).toBeDisabled();
  await axe(page);
  await sheet.locator('[data-photo="photo-Front-2026-09-05"]').click();
  await expect(sheet.locator('[data-slot="before"]')).toBeFocused();

  await sheet.getByRole('button', { name: 'Use these photos' }).click();
  await expect(sheet.getByRole('heading', { name: 'Make this before and after?' })).toBeVisible();
  await expect(sheet.locator('.named li')).toHaveText([
    /Before\s*Front photo, 5 September 2026/,
    /After\s*Front photo, 3 October 2026/,
  ]);
  // Seeing the confirmation asks nothing of the server.
  expect(asked.exports).toEqual([]);
  await page.waitForTimeout(600);
  await axe(page);
  await page.screenshot({ path: 'test-results/r61b-confirm-390.png' });

  await sheet.getByRole('button', { name: 'Make the picture' }).click();
  expect(await pictureSize(page)).toEqual({ width: 1080, height: 1920 });
  expect(asked.exports).toEqual([
    { beforePhotoId: 'photo-Front-2026-09-05', afterPhotoId: 'photo-Front-2026-10-03' },
  ]);
  // The full pictures are asked for only once the export is recorded.
  expect(asked.order.slice(-2)).toEqual([
    'export',
    'grant asset-Front-2026-09-05 asset-Front-2026-10-03',
  ]);
  await expect(sheet.locator('.preview img')).toHaveAttribute(
    'alt',
    'Before and after. Front photos from 5 September to 3 October 2026, 4 weeks apart. Maya · coached by Atlas Performance',
  );
  await page.waitForTimeout(600);
  await axe(page);
  await page.screenshot({ path: 'test-results/r61b-share-390.png' });

  await sheet.getByRole('button', { name: 'Share', exact: true }).click();
  await expect(sheet.getByRole('status')).toHaveText('Shared.');
  expect(await page.evaluate(() => (window as unknown as { shared: unknown }).shared)).toEqual([
    { name: 'front-before-and-after.png', type: 'image/png' },
  ]);

  // Closing forgets the photos; opening again starts afresh at the first and latest.
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  await page.getByRole('button', { name: 'Share a before and after' }).click();
  await expect(sheet.locator('[data-slot="before"]')).toContainText('Sat 4 Jul 2026');
});

test('a wide screen in dark mode saves a side before and after under its own name', async ({
  page,
}) => {
  await openPhotos(page, { width: 1440, dark: true });
  await page.getByRole('button', { name: 'Share a before and after' }).click();
  const sheet = page.getByRole('dialog', { name: 'Before and after' });
  await sheet.getByRole('radio', { name: 'Side' }).check();
  await expect(sheet.locator('[data-slot="before"]')).toContainText('Sat 1 Aug 2026');
  await page.waitForTimeout(600);
  await axe(page);
  await page.screenshot({ path: 'test-results/r61b-pick-1440-dark.png' });

  await sheet.getByRole('button', { name: 'Use these photos' }).click();
  await sheet.getByRole('button', { name: 'Make the picture' }).click();
  expect(await pictureSize(page)).toEqual({ width: 1080, height: 1920 });
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    sheet.getByRole('button', { name: 'Save image' }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('side-before-and-after.png');
  await page.waitForTimeout(600);
  await axe(page);
  await page.screenshot({ path: 'test-results/r61b-share-1440-dark.png' });
});

test('the steps reflow at 200% text and read right to left on a page that does', async ({
  page,
}) => {
  await openPhotos(page);
  await useRtl(page);
  await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
  await page.getByRole('button', { name: 'Share a before and after' }).click();
  const sheet = page.getByRole('dialog', { name: 'Before and after' });
  await expect(sheet.getByRole('heading', { name: 'Choose your photos' })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await sheet.getByRole('button', { name: 'Use these photos' }).click();
  await expectNoHorizontalOverflow(page);
  await sheet.getByRole('button', { name: 'Make the picture' }).click();
  expect(await pictureSize(page)).toEqual({ width: 1080, height: 1920 });
  await expectNoHorizontalOverflow(page);
  await axe(page);
});

test.describe('a photo removed meanwhile', () => {
  test.use({
    allowedConsoleErrors: { patterns: [/status of 409 .*\/api\/progress\/me\/photo-exports/] },
  });

  test('is refused by the server, and nothing is made', async ({ page }) => {
    const asked = await openPhotos(page, { refuse: true });
    await page.getByRole('button', { name: 'Share a before and after' }).click();
    const sheet = page.getByRole('dialog', { name: 'Before and after' });
    await sheet.getByRole('button', { name: 'Use these photos' }).click();
    await sheet.getByRole('button', { name: 'Make the picture' }).click();

    await expect(sheet.getByRole('alert')).toHaveText(
      'One of these photos can no longer be used. Choose again.',
    );
    await expect(sheet.getByRole('heading', { name: 'Choose your photos' })).toBeVisible();
    await expect(sheet.locator('.preview')).toHaveCount(0);
    expect(asked.exports).toHaveLength(1);
    expect(asked.order.filter((call) => call.startsWith('grant'))).not.toContain(
      'grant asset-Front-2026-07-04 asset-Front-2026-10-03',
    );
    await axe(page);
  });
});
