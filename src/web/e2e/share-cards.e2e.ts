import AxeBuilder from '@axe-core/playwright';
import type { Page, Route } from '@playwright/test';
import { personalRecord, programSummary } from '../src/testing/share-card-fixtures';
import { historyPage, programView } from '../src/testing/training-program-fixtures';
import {
  expect,
  expectNoHorizontalOverflow,
  json,
  mockSession,
  SIGNED_IN_USER,
  test,
  useRtl,
  waitForFonts,
} from './support';

/**
 * Share cards (R6.1a, M9): the finish summary offers the program a workout finished and its records,
 * and Training offers a finished program. The picture is drawn by the browser on the page; these
 * checks look at what it made and where it went, never at a server, which is sent nothing.
 */
const membership = {
  tenantId: '00000000-0000-4000-8000-000000000003',
  tenantName: 'Atlas Performance',
  tenantSlug: 'atlas-performance',
  role: 'Client',
};
const maya = { ...SIGNED_IN_USER, displayName: 'Maya Fakhoury' };
const decisions = ['Training', 'Nutrition', 'CheckIns', 'Messaging', 'ResourceLibrary'].map(
  (feature) => ({ feature, isAllowed: true, reason: 'Granted' }),
);

const set = {
  prescriptionId: 'set-prescription-1',
  performanceId: 'set-1',
  position: 1,
  setType: 'Normal',
  prescribedRepetitionsMinimum: 6,
  prescribedRepetitionsMaximum: 6,
  prescribedLoad: 60,
  prescribedLoadUnit: 'Kilogram',
  prescribedTargetRpe: 8,
  prescribedTargetRir: null,
  restSeconds: 90,
  tempo: null,
  coachNotes: null,
  actualRepetitions: 6,
  actualLoad: 62.5,
  actualLoadUnit: 'Kilogram',
  actualRpe: null,
  actualRir: null,
  isCompleted: true,
  clientNote: null,
};
const workout = {
  sessionId: 'session-1',
  mesocycleId: 'block-1',
  workoutExecutionId: 'workout-1',
  name: 'Upper A',
  coachNotes: null,
  status: 'InProgress',
  startedAtUtc: '2026-10-05T08:00:00Z',
  executionVersion: 4,
  exercises: [
    {
      prescriptionId: 'exercise-prescription-1',
      performanceId: 'exercise-1',
      prescribedExerciseId: 'bench',
      prescribedExerciseName: 'Barbell bench press',
      actualExerciseId: 'bench',
      actualExerciseName: 'Barbell bench press',
      wasSubstituted: false,
      modificationPolicy: 'Locked',
      alternatives: [],
      coachNotes: null,
      mediaAssetIds: [],
      previousPerformance: null,
      sets: [set],
    },
  ],
  notes: [],
};

/** A phone's share sheet as the page sees it: it takes pictures and keeps what it was handed. */
function phoneShareSheet() {
  const shareable = (data?: ShareData) => Boolean(data?.files?.length);
  Object.assign(navigator, {
    canShare: shareable,
    share: async (data: ShareData) => {
      (window as unknown as { shared: unknown }).shared = (data.files ?? []).map((file) => ({
        name: file.name,
        type: file.type,
        size: file.size,
      }));
    },
  });
}

async function finishWorkout(page: Page, width: number, height: number) {
  await page.setViewportSize({ width, height });
  await mockSession(page, {
    memberships: [membership],
    user: maya,
    extra: {
      'GET /api/client-access/me': (route: Route) => json(route, 200, decisions),
      'GET /api/training/me/today': (route: Route) =>
        json(route, 200, {
          isAllowed: true,
          accessReason: 'Granted',
          localDate: '2026-10-05',
          workouts: [workout],
        }),
      'GET /api/training/me/upcoming': (route: Route) =>
        json(route, 200, {
          isAllowed: true,
          accessReason: 'Granted',
          localDate: '2026-10-05',
          timeZoneId: 'Asia/Beirut',
          hasAssignedProgram: true,
          hasVisibleSessions: true,
          searchThrough: '2027-01-03',
          nextSession: null,
          unfinishedWorkouts: [],
          nextSkip: null,
          todayCoverage: null,
        }),
      'POST /api/training/me/workouts/workout-1/complete': (route: Route) =>
        json(route, 200, {
          id: 'workout-1',
          status: 'Completed',
          version: 5,
          startedAtUtc: '2026-10-05T08:00:00Z',
          completedAtUtc: '2026-10-05T09:00:00Z',
          finishSummary: {
            durationSeconds: 3600,
            completedSetCount: 1,
            totalSetCount: 1,
            volume: [{ unit: 'Kilogram', loadTimesRepetitions: 375 }],
            personalRecords: [personalRecord()],
            finishedProgram: programSummary(),
          },
        }),
    },
  });
  await page.goto('/training/today');
  await page.getByRole('button', { name: 'Finish workout' }).click();
  await page.getByRole('button', { name: 'Confirm finish' }).click();
  await expect(page.getByRole('heading', { name: /Workout done/ })).toBeVisible();
  await waitForFonts(page);
}

async function openTraining(page: Page, width: number, summary: unknown, dark = false) {
  await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
  const finished = programView();
  finished.program!.phase = 'Finished';
  finished.program!.currentWeekNumber = null;
  await mockSession(page, {
    memberships: [membership],
    user: { ...maya, preferredThemeMode: dark ? 'dark' : 'light' },
    extra: {
      'GET /api/client-access/me': (route: Route) => json(route, 200, decisions),
      'GET /api/training/me/program': (route: Route) => json(route, 200, finished),
      'GET /api/training/me/history': (route: Route) => json(route, 200, historyPage()),
      'GET /api/training/me/programs/block-1/summary': (route: Route) => json(route, 200, summary),
    },
  });
  await page.goto('/training/program');
  await expect(page.locator('.hero-eyebrow')).toHaveText('Program finished');
  await waitForFonts(page);
}

/** The picture the sheet shows, as the browser decoded it. */
async function pictureSize(page: Page) {
  const picture = page.locator('.tb-modal-pane--sheet .preview img');
  await expect(picture).toBeVisible();
  return picture.evaluate((image: HTMLImageElement) =>
    image.decode().then(() => ({ width: image.naturalWidth, height: image.naturalHeight })),
  );
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

test('a phone shares the finished program’s picture through its own share sheet', async ({
  page,
}) => {
  await page.addInitScript(phoneShareSheet);
  await finishWorkout(page, 390, 844);

  const teaser = page.locator('app-share-teaser');
  await expect(teaser.locator('.kicker')).toHaveText('Program complete');
  await expect(teaser.locator('.headline')).toHaveText('8 weeks');
  await page.waitForTimeout(1400);
  await axe(page);
  await page.screenshot({ path: 'test-results/r61a-summary-390.png', fullPage: true });

  const share = page.getByRole('button', { name: 'Share your progress' });
  await share.click();
  const sheet = page.getByRole('dialog', { name: 'Share your progress' });
  await expect(sheet).toBeVisible();
  // The player is always dark, and so is the sheet over it.
  await expect(page.locator('.tb-modal-pane--sheet')).toHaveAttribute('data-mode', 'dark');
  expect(await pictureSize(page)).toEqual({ width: 1080, height: 1920 });
  await expect(sheet.locator('.preview img')).toHaveAttribute(
    'alt',
    'Program complete. Strength Foundations, 8 weeks. 30 workouts, 7 personal records. Maya · coached by Atlas Performance',
  );
  await axe(page);
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'test-results/r61a-sheet-390.png' });

  await sheet.getByRole('button', { name: 'Share', exact: true }).click();
  await expect(sheet.getByRole('status')).toHaveText('Shared.');
  const shared = await page.evaluate(() => (window as unknown as { shared: unknown }).shared);
  expect(shared).toEqual([
    { name: 'strength-foundations-complete.png', type: 'image/png', size: expect.any(Number) },
  ]);
  expect((shared as { size: number }[])[0].size).toBeGreaterThan(20_000);

  await sheet.getByRole('radio', { name: 'Barbell bench press' }).check();
  await expect(sheet.locator('.preview img')).toHaveAttribute(
    'alt',
    /Barbell bench press, 62.5 kg × 6/,
  );
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  await expect(share).toBeFocused();
});

test('a wide screen saves the record’s picture under its own name', async ({ page }) => {
  await finishWorkout(page, 1440, 900);
  await page.getByRole('button', { name: 'Share your progress' }).click();
  const sheet = page.getByRole('dialog', { name: 'Share your progress' });
  await sheet.getByRole('radio', { name: 'Barbell bench press' }).check();
  expect(await pictureSize(page)).toEqual({ width: 1080, height: 1920 });
  // A desktop browser that cannot hand a picture to a share sheet offers Save image alone.
  await expect(sheet.getByRole('button', { name: 'Share', exact: true })).toHaveCount(0);
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    sheet.getByRole('button', { name: 'Save image' }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('barbell-bench-press-personal-record.png');
  await expect(sheet.getByRole('status')).toHaveText('Your picture is downloading.');
  await axe(page);
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'test-results/r61a-sheet-1440.png' });
});

for (const dark of [false, true]) {
  test(`Training offers a finished program’s card ${dark ? 'in dark mode' : 'in light mode'}, reflowing at 200% text`, async ({
    page,
  }) => {
    await openTraining(
      page,
      390,
      { isAllowed: true, accessReason: 'Granted', program: programSummary() },
      dark,
    );
    await page.getByRole('button', { name: 'Share your program' }).click();
    const sheet = page.getByRole('dialog', { name: 'Share your program' });
    expect(await pictureSize(page)).toEqual({ width: 1080, height: 1920 });
    // Training follows the person's own mode, and its sheet does too.
    expect(await page.locator('.tb-modal-pane--sheet').getAttribute('data-mode')).toBeNull();
    await expect(sheet.getByRole('radio')).toHaveCount(0);
    await axe(page);
    await page.waitForTimeout(400);
    await page.screenshot({
      path: `test-results/r61a-training-sheet-${dark ? 'dark' : 'light'}.png`,
    });
    await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
    await expectNoHorizontalOverflow(page);
    await expect(sheet.getByRole('button', { name: 'Save image' })).toBeVisible();
  });
}

test('a finished program’s card reads right to left on a page that does', async ({ page }) => {
  await openTraining(page, 390, {
    isAllowed: true,
    accessReason: 'Granted',
    program: programSummary(),
  });
  await useRtl(page);
  await page.getByRole('button', { name: 'Share your program' }).click();
  expect(await pictureSize(page)).toEqual({ width: 1080, height: 1920 });
  await expectNoHorizontalOverflow(page);
  await axe(page);
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'test-results/r61a-training-sheet-rtl.png' });
});

test('a finished program’s card that cannot be read says why, and opens nothing', async ({
  page,
}) => {
  await openTraining(page, 1440, { isAllowed: false, accessReason: 'Expired', program: null });
  await page.getByRole('button', { name: 'Share your program' }).click();
  await expect(page.locator('.hero-problem')).toHaveText(
    'Your coaching plan has ended. Contact your coach.',
  );
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await axe(page);
});
