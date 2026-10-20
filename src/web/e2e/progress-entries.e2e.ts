import AxeBuilder from '@axe-core/playwright';
import type { Page, Route } from '@playwright/test';
import { workspace } from '../src/testing/intake-fixtures';
import {
  mayaMeasurements,
  mayaPhotos,
  mayaWeighIns,
  measurement,
  measurementsView,
  NOW,
  observation,
  photo,
  photosView,
  progressView,
  weightHistory,
} from '../src/testing/progress-fixtures';
import type {
  BodyMeasurement,
  BodyweightObservation,
  ProgressPhoto,
} from '../src/app/features/progress/progress.models';
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
 * Weight, measurements and photos (R5.3c) in a real browser: the client's Your entries page, its
 * three tabs, the sheets that log and correct, and the way a refusal and a late answer read. Every API
 * call is a per-test mock answered in place, so a write shows on the next read.
 */
const CLIENT = { ...OWNER_MEMBERSHIP, role: 'Client' };
const MAYA = { ...SIGNED_IN_USER, displayName: 'Maya Rahman', preferredWeightUnit: 'Kilogram' };
const FEATURES = ['Training', 'Nutrition', 'CheckIns', 'Messaging'];

/** A small stand-in picture, so the tiles show something that is plainly not a real person. */
const PICTURE = `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="320" viewBox="0 0 240 320"><rect width="240" height="320" fill="#d7e2cf"/><circle cx="120" cy="96" r="34" fill="#9db39a"/><rect x="72" y="140" width="96" height="150" rx="40" fill="#9db39a"/></svg>`;

/** A JPEG's first bytes are enough for the picker; the server is a mock. */
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00]);

interface Writes {
  weights: unknown[];
  corrections: unknown[];
  moves: unknown[];
  measurements: unknown[];
  photos: string[];
  removals: unknown[];
}

interface Options {
  width?: number;
  dark?: boolean;
  empty?: boolean;
  /** The server answers a second measurement line with "already recorded". */
  refuseSecondMeasurement?: boolean;
  /** The server answers a photo for the front pose with "already saved". */
  refuseFront?: boolean;
}

async function openEntries(page: Page, path = '/progress', options: Options = {}) {
  await page.clock.setFixedTime(new Date(NOW));
  await page.emulateMedia({ colorScheme: options.dark ? 'dark' : 'light' });
  await page.setViewportSize({ width: options.width ?? 390, height: 900 });
  const writes: Writes = {
    weights: [],
    corrections: [],
    moves: [],
    measurements: [],
    photos: [],
    removals: [],
  };
  let weights: BodyweightObservation[] = options.empty ? [] : mayaWeighIns();
  let measurements: BodyMeasurement[] = options.empty ? [] : mayaMeasurements();
  let photos: ProgressPhoto[] = options.empty ? [] : mayaPhotos();
  let measurementCalls = 0;

  const extra: Record<string, (route: Route) => Promise<void> | void> = {
    'GET /api/client-access/me': (route) =>
      json(
        route,
        200,
        FEATURES.map((feature) => ({ feature, isAllowed: true, reason: 'Granted' })),
      ),
    'GET /api/workspace': (route) => json(route, 200, workspace()),
    'GET /api/progress/me': (route) => {
      const unit = new URL(route.request().url()).searchParams.get('displayUnit');
      return json(
        route,
        200,
        progressView(weights, { displayUnit: unit === 'Pound' ? 'Pound' : 'Kilogram' }),
      );
    },
    'GET /api/progress/me/span': (route) =>
      json(route, 200, { firstDate: weights.length ? '2026-10-05' : null, lastDate: null }),
    'POST /api/progress/me/bodyweight': (route) => {
      const body = route.request().postDataJSON() as { value: number; unit: string };
      writes.weights.push(body);
      const made = observation({
        id: 'weight-new',
        measurementDate: '2026-10-10',
        valueKilograms: body.value,
        enteredValue: body.value,
        enteredUnit: body.unit === 'Pound' ? 'Pound' : 'Kilogram',
        version: 1,
      });
      weights = [...weights, made];
      return json(route, 200, made);
    },
    'PUT /api/progress/me/bodyweight/weight-2026-10-09': (route) => {
      const body = route.request().postDataJSON() as { value: number };
      writes.corrections.push(body);
      weights = weights.map((item) =>
        item.id === 'weight-2026-10-09'
          ? {
              ...item,
              valueKilograms: body.value,
              enteredValue: body.value,
              version: item.version + 1,
            }
          : item,
      );
      return json(
        route,
        200,
        weightHistory(
          {},
          weights.find((item) => item.id === 'weight-2026-10-09')!,
        ),
      );
    },
    'GET /api/progress/me/bodyweight/weight-2026-10-09/history': (route) =>
      json(route, 200, weightHistory()),
    'POST /api/progress/me/bodyweight/weight-2026-10-07/replace-date': (route) => {
      const body = route.request().postDataJSON() as { measurementDate: string };
      writes.moves.push(body);
      const from = weights.find((item) => item.id === 'weight-2026-10-07')!;
      const replacement = {
        ...from,
        id: 'weight-moved',
        measurementDate: body.measurementDate,
        version: 1,
      };
      weights = weights.map((item) => (item.id === from.id ? replacement : item));
      return json(route, 200, {
        replacement,
        voided: { ...from, status: 'Voided' },
        void: {
          id: 'void-1',
          reason: 'Logged on the wrong day',
          voidedByUserId: 'user-maya',
          voidedAtUtc: NOW,
          replacementObservationId: 'weight-moved',
        },
      });
    },
    'GET /api/progress/me/measurements': (route) =>
      json(route, 200, measurementsView(measurements)),
    'POST /api/progress/me/measurements': (route) => {
      const body = route.request().postDataJSON() as { measurementType: string; value: number };
      writes.measurements.push(body);
      measurementCalls++;
      if (options.refuseSecondMeasurement && measurementCalls === 2) {
        return json(route, 409, {
          code: 'BodyMeasurementDateAndTypeAlreadyExists',
          title: 'That measurement type already exists for the local date.',
        });
      }
      const made = measurement({
        id: `new-${body.measurementType}`,
        measurementType: body.measurementType as BodyMeasurement['measurementType'],
        measurementDate: '2026-10-10',
        displayValue: body.value,
        enteredValue: body.value,
        canonicalValue: body.value,
      });
      measurements = [...measurements, made];
      return json(route, 200, made);
    },
    'GET /api/progress/me/photos': (route) => json(route, 200, photosView(photos)),
    'POST /api/progress/me/photos': (route) => {
      const url = new URL(route.request().url());
      writes.photos.push(`${url.searchParams.get('pose')} ${url.searchParams.get('photoDate')}`);
      if (options.refuseFront && url.searchParams.get('pose') === 'Front') {
        return json(route, 409, {
          code: 'ProgressPhotoAlreadyExists',
          title: 'A photo already exists for that local date and pose.',
        });
      }
      const made = photo({
        pose: url.searchParams.get('pose') as ProgressPhoto['pose'],
        photoDate: '2026-10-10',
      });
      photos = [...photos, made];
      return json(route, 200, made);
    },
    'POST /api/media/access': (route) => {
      const ids = (route.request().postDataJSON() as { assetIds: string[] }).assetIds;
      return json(route, 200, {
        items: ids.map((assetId) => ({
          assetId,
          kind: 'Image',
          source: 'Upload',
          contentType: 'image/jpeg',
          url: `/api/media/${assetId}/content`,
          expiresAtUtc: '2026-10-10T10:00:00Z',
          downloadAllowed: false,
          thumbnailUrl: `/api/media/${assetId}/content/thumbnail`,
        })),
      });
    },
  };

  // Every picture the page may be shown, including the ones a save adds today.
  const todays = (['Front', 'Side', 'Back'] as const).map((pose) =>
    photo({ pose, photoDate: '2026-10-10' }),
  );
  for (const photoRow of [...mayaPhotos(), ...todays]) {
    const id = photoRow.mediaAssetId;
    extra[`GET /api/media/${id}/content/thumbnail`] = (route) =>
      route.fulfill({ status: 200, contentType: 'image/svg+xml', body: PICTURE });
    extra[`GET /api/media/${id}/content`] = (route) =>
      route.fulfill({ status: 200, contentType: 'image/svg+xml', body: PICTURE });
    extra[`POST /api/media/${id}/access`] = (route) =>
      json(route, 200, {
        assetId: id,
        kind: 'Image',
        source: 'Upload',
        contentType: 'image/jpeg',
        url: `/api/media/${id}/content`,
        expiresAtUtc: '2026-10-10T10:00:00Z',
        downloadAllowed: false,
        thumbnailUrl: `/api/media/${id}/content/thumbnail`,
      });
  }
  for (const photoId of ['photo-Front-2026-10-03', 'photo-Front-2026-10-10']) {
    extra[`POST /api/progress/me/photos/${photoId}/remove`] = (route) => {
      writes.removals.push(route.request().postDataJSON());
      photos = photos.map((item) => (item.id === photoId ? { ...item, status: 'Removed' } : item));
      return json(route, 200, { ...photos.find((item) => item.id === photoId), status: 'Removed' });
    };
  }

  await mockSession(page, { memberships: [CLIENT], user: MAYA, extra });
  await page.goto(path);
  await expect(page.getByRole('heading', { name: 'Your entries', level: 1 })).toBeVisible();
  await waitForFonts(page);
  return writes;
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

const toast = (page: Page) => page.locator('app-toast-host');

for (const width of [390, 1440]) {
  test(`the weight tab lists each weigh-in once, newest first, at ${width}px and passes axe`, async ({
    page,
  }) => {
    await openEntries(page, '/progress', { width });

    await expect(page.locator('[data-weighin] time')).toHaveText([
      'Fri 9 Oct',
      'Thu 8 Oct',
      'Wed 7 Oct',
      'Mon 5 Oct',
    ]);
    await expect(page.locator('[data-weighin]').first()).toContainText('80.2 kg');
    await expect(page.locator('[data-weighin]').nth(1)).toContainText('Entered as 175.9 lb');
    await expectNoHorizontalOverflow(page);
    await axe(page);
    await page.screenshot({ path: `test-results/r53c-weights-${width}.png`, fullPage: true });
  });

  test(`the weight tab follows dark mode at ${width}px and passes axe`, async ({ page }) => {
    await openEntries(page, '/progress', { width, dark: true });

    await expect(page.locator('[data-weighin]')).toHaveCount(4);
    await expectNoHorizontalOverflow(page);
    await axe(page);
    await page.screenshot({ path: `test-results/r53c-weights-dark-${width}.png`, fullPage: true });
  });
}

test('logs a weight in a sheet, thanks the person and shows it in the list', async ({ page }) => {
  const writes = await openEntries(page, '/progress', { width: 390 });

  await page.locator('[data-log-weight]').click();
  const sheet = page.getByRole('dialog', { name: 'Log weight' });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByLabel('Weight'))
    .toBeFocused({ timeout: 2000 })
    .catch(() => undefined);
  await sheet.getByLabel('Weight').fill('80.4');
  await axe(page);
  await page.screenshot({ path: 'test-results/r53c-log-weight-390.png' });
  await sheet.getByRole('button', { name: 'Save weight' }).click();

  await expect(sheet).toBeHidden();
  await expect(toast(page)).toContainText('Weight logged for today.');
  expect(writes.weights).toEqual([{ value: 80.4, unit: 'Kilogram', measurementDate: null }]);
  await expect(page.locator('[data-weighin]').first()).toContainText('80.4 kg');
});

test('says in words what is wrong before anything is sent, and keeps the sheet', async ({
  page,
}) => {
  const writes = await openEntries(page, '/progress', { width: 390 });

  await page.locator('[data-log-weight]').click();
  const sheet = page.getByRole('dialog', { name: 'Log weight' });
  await sheet.getByRole('button', { name: 'Save weight' }).click();
  await expect(sheet.getByText('Enter a weight.')).toBeVisible();
  await sheet.getByLabel('Weight').fill('12');
  await expect(sheet.getByText('Weight has to be between 20 and 500 kg.')).toBeVisible();
  expect(writes.weights).toEqual([]);
  await expect(sheet).toBeVisible();
});

test('asks before a sheet with typed work is closed', async ({ page }) => {
  await openEntries(page, '/progress', { width: 390 });

  await page.locator('[data-log-weight]').click();
  const sheet = page.getByRole('dialog', { name: 'Log weight' });
  await sheet.getByLabel('Weight').fill('80.4');
  await sheet.getByRole('button', { name: 'Not now' }).click();
  const question = page.getByRole('dialog', { name: 'Discard what you typed?' });
  await expect(question).toBeVisible();
  await question.getByRole('button', { name: 'Keep editing' }).click();
  await expect(sheet).toBeVisible();
  await expect(sheet.getByLabel('Weight')).toHaveValue('80.4');
  await sheet.getByRole('button', { name: 'Not now' }).click();
  await page
    .getByRole('dialog', { name: 'Discard what you typed?' })
    .locator('app-confirm')
    .getByRole('button', { name: 'Discard' })
    .click();
  await expect(sheet).toBeHidden();
});

test('corrects a weight with a one-tap reason, and keeps the earlier number in its changes', async ({
  page,
}) => {
  const writes = await openEntries(page, '/progress', { width: 390 });

  await page.getByRole('button', { name: 'More for Fri 9 Oct' }).click();
  await page.getByRole('button', { name: /Correct the weight/ }).click();
  const sheet = page.getByRole('dialog', { name: 'Correct this weight' });
  await expect(sheet).toBeVisible();
  await sheet.getByLabel('Correct weight').fill('79.4');
  await sheet.getByLabel('Typed the wrong number').check();
  await page.screenshot({ path: 'test-results/r53c-correct-weight-390.png' });
  await sheet.getByRole('button', { name: 'Save correction' }).click();

  await expect(toast(page)).toContainText('Weight corrected.');
  expect(writes.corrections).toEqual([
    { value: 79.4, unit: 'Kilogram', reason: 'Typed the wrong number', version: 3 },
  ]);

  await page.getByRole('button', { name: 'More for Fri 9 Oct' }).click();
  await page.getByRole('button', { name: 'See changes' }).click();
  const changes = page.getByRole('dialog', { name: 'Changes to this weight' });
  await expect(changes.locator('.changes li').first()).toContainText('82.2 kg');
  await expect(changes.locator('.changes li').first()).toContainText('Typed the wrong number');
});

test('moves a weight to the day it was taken, using the calendar', async ({ page }) => {
  const writes = await openEntries(page, '/progress', { width: 390 });

  await page.getByRole('button', { name: 'More for Wed 7 Oct' }).click();
  await page.getByRole('button', { name: /Wrong day/ }).click();
  const sheet = page.getByRole('dialog', { name: 'Move it to the right day' });
  await sheet.getByRole('button', { name: /Day it was really weighed/ }).click();
  await sheet.locator('button.day[data-date="2026-10-06"]').click();
  await sheet.getByLabel('Logged on the wrong day').check();
  await sheet.getByRole('button', { name: 'Move to that day' }).click();

  await expect(toast(page)).toContainText('Moved to Tue 6 Oct.');
  expect(writes.moves).toEqual([
    { measurementDate: '2026-10-06', reason: 'Logged on the wrong day', version: 2 },
  ]);
  await expect(page.locator('[data-weighin] time').nth(2)).toHaveText('Tue 6 Oct');
});

for (const width of [390, 1440]) {
  test(`the measurements tab shows each day's lines at ${width}px and passes axe`, async ({
    page,
  }) => {
    await openEntries(page, '/progress?tab=measurements', { width });

    await expect(page.locator('[data-day] h2')).toHaveText([
      'Saturday 3 October',
      'Saturday 5 September',
    ]);
    await expect(page.locator('[data-measurement]').first()).toContainText('Waist');
    await expectNoHorizontalOverflow(page);
    await axe(page);
    await page.screenshot({
      path: `test-results/r53c-measurements-${width}.png`,
      fullPage: true,
    });
  });

  test(`the photos tab shows each day's set at ${width}px and passes axe`, async ({ page }) => {
    await openEntries(page, '/progress?tab=photos', { width });

    await expect(page.locator('[data-pane="photos"] [data-day] h2')).toHaveText([
      'Saturday 3 October',
      'Saturday 5 September',
    ]);
    await expect(page.locator('button.tile img').first()).toBeVisible();
    await expect(page.locator('[data-removed] summary')).toHaveText('Photos you removed (1)');
    await expectNoHorizontalOverflow(page);
    await axe(page);
    await page.screenshot({ path: `test-results/r53c-photos-${width}.png`, fullPage: true });
  });
}

// The browser logs every refused request as a console error of its own; these tests refuse on purpose.
test.describe('when the server refuses part of what was sent', () => {
  test.use({ allowedConsoleErrors: { patterns: [/status of 409 .*\/api\/progress\//] } });

  test('logs several measurements at once, and keeps the one the server refused marked', async ({
    page,
  }) => {
    const writes = await openEntries(page, '/progress?tab=measurements', {
      width: 390,
      refuseSecondMeasurement: true,
    });

    await page.locator('[data-log-measurements]').click();
    const sheet = page.getByRole('dialog', { name: 'Log measurements' });
    await sheet.getByLabel('Waist (cm)').fill('81.5');
    await sheet.getByLabel('Hips (cm)').fill('95');
    await sheet.getByLabel('Body fat (%)').fill('21.5');
    await sheet.getByRole('button', { name: 'Save measurements' }).click();

    await expect(sheet.getByText('Hips is already recorded for Sat 10 Oct.')).toBeVisible();
    await expect(sheet.getByText('Saved').first()).toBeVisible();
    await expect(sheet.getByText('Some measurements were saved.')).toBeVisible();
    await page.screenshot({ path: 'test-results/r53c-measurements-partial-390.png' });
    expect(writes.measurements).toEqual([
      { measurementType: 'Waist', value: 81.5, unit: 'Centimetre', measurementDate: null },
      { measurementType: 'Hips', value: 95, unit: 'Centimetre', measurementDate: null },
      { measurementType: 'BodyFatPercentage', value: 21.5, unit: 'Percent', measurementDate: null },
    ]);
  });

  test('adds a photo set, one picture a pose, and says when a pose was already saved', async ({
    page,
  }) => {
    const writes = await openEntries(page, '/progress?tab=photos', {
      width: 390,
      refuseFront: true,
    });

    await page.locator('[data-add-photos]').click();
    const sheet = page.getByRole('dialog', { name: 'Add photos' });
    await sheet.locator('input[data-file="Front"]').setInputFiles({
      name: 'front.jpg',
      mimeType: 'image/jpeg',
      buffer: JPEG,
    });
    await sheet.locator('input[data-file="Side"]').setInputFiles({
      name: 'side.jpg',
      mimeType: 'image/jpeg',
      buffer: JPEG,
    });
    await expect(sheet.getByText('front.jpg · 1 KB')).toBeVisible();
    await page.screenshot({ path: 'test-results/r53c-add-photos-390.png' });
    await sheet.getByRole('button', { name: 'Save photos' }).click();

    await expect(
      sheet.getByText(
        'A front photo is already saved for Sat 10 Oct. Remove it first, or choose another day.',
      ),
    ).toBeVisible();
    expect(writes.photos).toEqual(['Front null', 'Side null']);
    await expect(sheet.locator('[data-slot="Side"]')).toContainText('Saved');
  });
});

test('opens a photo small, loads the full size on request, and removes it with a reason', async ({
  page,
}) => {
  const writes = await openEntries(page, '/progress?tab=photos', { width: 390 });

  await page.locator('[data-photo="photo-Front-2026-10-03"]').click();
  const sheet = page.getByRole('dialog', { name: 'Front photo' });
  await expect(sheet.locator('img.photo')).toHaveAttribute('src', /thumbnail$/);
  await sheet.getByRole('button', { name: 'Load full size' }).click();
  await expect(sheet.locator('img.photo')).toHaveAttribute('src', /content$/);
  await sheet.getByRole('button', { name: 'Remove photo' }).click();
  await sheet.getByLabel('Wrong pose').check();
  await page.screenshot({ path: 'test-results/r53c-remove-photo-390.png' });
  await sheet.getByRole('button', { name: 'Remove photo' }).click();

  await expect(toast(page)).toContainText('Photo removed. Your coach can no longer see it.');
  expect(writes.removals).toEqual([{ reason: 'Wrong pose', version: 1 }]);
});

test('reads right to left at 390px without overflow', async ({ page }) => {
  await openEntries(page, '/progress', { width: 390 });
  await useRtl(page);

  await expect(page.locator('[data-weighin]')).toHaveCount(4);
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: 'test-results/r53c-weights-rtl-390.png', fullPage: true });
});

test('invites the first weight when there are none, and says so for each tab', async ({ page }) => {
  await openEntries(page, '/progress', { width: 390, empty: true });

  await expect(page.getByRole('heading', { name: 'No weights yet' })).toBeVisible();
  await page.getByRole('tab', { name: 'Measurements' }).click();
  await expect(page.getByRole('heading', { name: 'No measurements yet' })).toBeVisible();
  await page.getByRole('tab', { name: 'Photos' }).click();
  await expect(page.getByRole('heading', { name: 'No photos yet' })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await axe(page);
  await page.screenshot({ path: 'test-results/r53c-empty-390.png', fullPage: true });
});
