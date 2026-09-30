import AxeBuilder from '@axe-core/playwright';
import type { Page, Route } from '@playwright/test';
import { expect, json, mockSession, SIGNED_IN_USER, test, waitForFonts } from './support';

const membership = {
  tenantId: '00000000-0000-4000-8000-000000000003',
  tenantName: 'Atlas Performance',
  tenantSlug: 'atlas-performance',
  role: 'Client',
};
const features = ['Training', 'Nutrition', 'CheckIns', 'Messaging', 'ResourceLibrary'].map(
  (feature) => ({ feature, isAllowed: true, reason: 'Granted' }),
);
const dashboard = {
  clientProfileId: 'client-1',
  timeZoneId: 'Asia/Beirut',
  weekStartsOn: 'Monday',
  from: '2026-07-08',
  toExclusive: '2026-09-30',
  windowDayCount: 84,
  displayUnit: 'Kilogram',
  measurementDisplayUnit: 'Centimetre',
  bodyweight: {
    latest: { id: 'weight-1', measurementDate: '2026-09-28' },
    latestDisplayValue: 81.5,
    change: {
      fromDate: '2026-09-21',
      fromValue: 82.4,
      toDate: '2026-09-28',
      toValue: 81.5,
      delta: -0.9,
    },
    weeks: [{ weekStart: '2026-09-21', displayMean: 81.9, observedDayCount: 2 }],
    trend: { availability: 'Available', latestDisplayEstimate: 81.7 },
    observedDayCount: 2,
  },
  measurements: {
    measurements: [
      {
        measurementType: 'Waist',
        displayUnit: 'Centimetre',
        latestDate: '2026-09-27',
        latestDisplayValue: 90,
        change: {
          fromDate: '2026-09-14',
          fromValue: 91,
          toDate: '2026-09-27',
          toValue: 90,
          delta: -1,
        },
        observationCount: 2,
      },
    ],
    observedDayCount: 2,
  },
  photos: { poses: [], photoCount: 0, missingThumbnailCount: 0, previewPhotoCount: 0 },
  nutrition: {
    feature: 'Nutrition',
    availability: 'Available',
    reason: 'Granted',
    context: {
      recentFrom: '2026-09-23',
      recentToExclusive: '2026-09-30',
      recentDayCount: 7,
      recentLoggedDayCount: 5,
      recentCompletedDayCount: 4,
      windowLoggedDayCount: 30,
      windowCompletedDayCount: 24,
      lastLoggedDate: '2026-09-29',
    },
  },
  training: {
    feature: 'Training',
    availability: 'Available',
    reason: 'Granted',
    context: {
      recentDayCount: 7,
      recentCompletedWorkoutCount: 3,
      recentScheduledSessionCount: 4,
      windowCompletedWorkoutCount: 20,
      windowScheduledSessionCount: 24,
    },
  },
};
const progress = {
  clientProfileId: 'client-1',
  timeZoneId: 'Asia/Beirut',
  weekStartsOn: 'Monday',
  from: '2026-07-08',
  toExclusive: '2026-09-30',
  displayUnit: 'Kilogram',
  days: [
    {
      date: '2026-09-21',
      observation: {
        id: 'weight-0',
        measurementDate: '2026-09-21',
        valueKilograms: 82.4,
        enteredValue: 82.4,
        enteredUnit: 'Kilogram',
        source: 'Client',
        recordedByUserId: 'client-1',
        recordedAtUtc: '2026-09-21T08:00:00Z',
        status: 'Active',
        version: 1,
      },
      displayValue: 82.4,
      trendEstimate: 82.3,
      trendSampleCount: 3,
    },
    {
      date: '2026-09-28',
      observation: {
        id: 'weight-1',
        measurementDate: '2026-09-28',
        valueKilograms: 81.5,
        enteredValue: 81.5,
        enteredUnit: 'Kilogram',
        source: 'Client',
        recordedByUserId: 'client-1',
        recordedAtUtc: '2026-09-28T08:00:00Z',
        status: 'Active',
        version: 1,
      },
      displayValue: 81.5,
      trendEstimate: 81.7,
      trendSampleCount: 4,
    },
  ],
  weeks: [
    {
      weekStart: '2026-09-21',
      weekEndExclusive: '2026-09-28',
      meanKilograms: 81.9,
      displayMean: 81.9,
      observedDayCount: 2,
    },
  ],
  trend: {
    availability: 'Available',
    methodKey: 'EWMA',
    methodVersion: 1,
    timeConstantDays: 7,
    warmupDays: 7,
    minimumSampleCount: 2,
    sampleCount: 4,
    latestEstimateKilograms: 81.7,
    latestDisplayEstimate: 81.7,
  },
};

async function session(page: Page, extra: Record<string, (route: Route) => void>): Promise<void> {
  await mockSession(page, {
    memberships: [membership],
    user: { ...SIGNED_IN_USER, displayName: 'Maya Rahman' },
    extra: { 'GET /api/client-access/me': (route) => json(route, 200, features), ...extra },
  });
}

async function accessible(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => {
    const root = document.scrollingElement ?? document.documentElement;
    return {
      width: root.scrollWidth,
      viewport: root.clientWidth,
      items: [...document.querySelectorAll<HTMLElement>('*')]
        .filter((item) => item.getBoundingClientRect().right > root.clientWidth + 1)
        .slice(0, 12)
        .map(
          (item) =>
            `${item.tagName}.${item.className} in ${item.parentElement?.tagName}.${item.parentElement?.className}`,
        ),
    };
  });
  expect(overflow.width, JSON.stringify(overflow)).toBeLessThanOrEqual(overflow.viewport);
  const violations = (await new AxeBuilder({ page }).analyze()).violations;
  expect(
    violations.map(({ id, nodes }) => ({
      id,
      targets: nodes.map((node) => ({ target: node.target, summary: node.failureSummary })),
    })),
  ).toEqual([]);
}

for (const width of [390, 1440]) {
  test(`Progress at ${width}px shows chart, records, ranges and weight sheet`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await session(page, {
      'GET /api/progress/me/dashboard': (route) => json(route, 200, dashboard),
      'GET /api/progress/me': (route) => json(route, 200, progress),
      'GET /api/progress/me/span': (route) =>
        json(route, 200, { firstDate: '2026-09-21', lastDate: '2026-09-28' }),
      'GET /api/training/me/personal-records': (route) =>
        json(route, 200, {
          isAllowed: true,
          accessReason: 'Granted',
          items: [
            {
              exerciseId: 'squat',
              exerciseName: 'Back squat',
              date: '2026-09-27',
              load: 105,
              unit: 'Kilogram',
              repetitions: 5,
              ruleKey: 'ExactRepsLoad',
              ruleVersion: 1,
            },
          ],
        }),
    });
    await page.goto('/progress/dashboard');
    await expect(page.getByRole('heading', { name: 'Your weight trend' })).toBeVisible();
    await expect(page.getByText('Back squat')).toBeVisible();
    await page.getByRole('button', { name: '4 w' }).click();
    await expect(page.getByRole('button', { name: '4 w' })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'All', exact: true }).click();
    await expect(page.getByText('Showing all recorded weight entries')).toBeVisible();
    await page.getByRole('button', { name: /Log weight/ }).click();
    await expect(page.getByRole('heading', { name: 'Log weight' })).toBeVisible();
    await page.keyboard.press('Escape');
    await waitForFonts(page);
    await accessible(page);
    await page.screenshot({ path: `../../docs/design/r23-progress-${width}.png`, fullPage: true });
    await page.evaluate(() => (document.documentElement.style.fontSize = '32px'));
    await accessible(page);
  });
}

const workoutSet = (position: number, id: string) => ({
  prescriptionId: `prescription-${id}`,
  performanceId: `set-${id}`,
  position,
  setType: 'Normal',
  prescribedRepetitionsMinimum: 5,
  prescribedRepetitionsMaximum: 5,
  prescribedLoad: 100,
  prescribedLoadUnit: 'Kilogram',
  prescribedTargetRpe: 8,
  prescribedTargetRir: null,
  restSeconds: 60,
  tempo: null,
  actualRepetitions: null,
  actualLoad: null,
  actualLoadUnit: null,
  actualRpe: null,
  actualRir: null,
  isCompleted: false,
  clientNote: null,
});
const workoutExercise = (name: string, id: string) => ({
  prescriptionId: `exercise-prescription-${id}`,
  performanceId: `exercise-performance-${id}`,
  prescribedExerciseId: id,
  prescribedExerciseName: name,
  actualExerciseId: id,
  actualExerciseName: name,
  wasSubstituted: false,
  modificationPolicy: 'Locked',
  alternatives: [],
  coachNotes: 'Use a steady pace.',
  mediaAssetIds: [],
  previousPerformance: {
    date: '2026-09-23',
    bestLoad: 100,
    unit: 'Kilogram',
    repetitions: 5,
    rpe: 8,
    sets: [{ position: 1, repetitions: 5, load: 100, loadUnit: 'Kilogram', rpe: 8 }],
  },
  sets: [workoutSet(1, id)],
});
const workout = {
  sessionId: 'session-1',
  mesocycleId: 'mesocycle-1',
  workoutExecutionId: 'workout-1',
  name: 'Full Body Strength',
  coachNotes: 'Move well.',
  status: 'InProgress',
  startedAtUtc: '2026-09-30T08:00:00Z',
  executionVersion: 1,
  exercises: [workoutExercise('Back squat', 'squat'), workoutExercise('Row', 'row')],
  notes: [],
};

for (const width of [390, 1440]) {
  test(`Workout player at ${width}px logs a PR and finishes`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await session(page, {
      'GET /api/training/me/today': (route) =>
        json(route, 200, {
          isAllowed: true,
          accessReason: 'Granted',
          localDate: '2026-09-30',
          workouts: [workout],
        }),
      'GET /api/training/me/upcoming': (route) =>
        json(route, 200, {
          isAllowed: true,
          accessReason: 'Granted',
          localDate: '2026-09-30',
          timeZoneId: 'Asia/Beirut',
          hasAssignedProgram: true,
          hasVisibleSessions: true,
          searchThrough: '2026-12-29',
          nextSession: null,
          unfinishedWorkouts: [],
          nextSkip: null,
          todayCoverage: null,
        }),
      'PUT /api/training/me/workouts/workout-1/sets/set-squat': (route) =>
        json(route, 200, {
          workoutExecutionId: 'workout-1',
          executionVersion: 2,
          setPerformanceId: 'set-squat',
          actualRepetitions: 5,
          actualLoad: 105,
          actualLoadUnit: 'Kilogram',
          actualRpe: null,
          actualRir: null,
          isCompleted: true,
          clientNote: null,
          isPersonalRecord: true,
          personalRecordRuleKey: 'ExactRepsLoad',
          personalRecordRuleVersion: 1,
        }),
      'POST /api/training/me/workouts/workout-1/complete': (route) =>
        json(route, 200, {
          id: 'workout-1',
          status: 'Completed',
          version: 3,
          finishSummary: {
            durationSeconds: 1800,
            completedSetCount: 1,
            totalSetCount: 2,
            volume: [{ unit: 'Kilogram', loadTimesRepetitions: 525 }],
            personalRecords: [
              {
                setPerformanceId: 'set-squat',
                exerciseName: 'Back squat',
                load: 105,
                unit: 'Kilogram',
                repetitions: 5,
              },
            ],
          },
        }),
    });
    await page.goto('/training/today');
    await expect(page.getByRole('heading', { name: 'Back squat' })).toBeVisible();
    await expect(page.locator('.previous-performance')).toBeVisible();
    await expect(page.getByRole('spinbutton', { name: 'Actual load', exact: true })).toHaveValue(
      '100',
    );
    await waitForFonts(page);
    await accessible(page);
    await page.screenshot({ path: `../../docs/design/r22-workout-${width}.png`, fullPage: true });
    await page.getByRole('spinbutton', { name: 'Actual load', exact: true }).fill('105');
    await page.getByRole('button', { name: 'Log set' }).click();
    await expect(page.getByText('PR', { exact: true })).toBeVisible();
    await expect(page.getByRole('timer')).toBeVisible();
    await page.getByRole('button', { name: 'Skip' }).click();
    await page.getByRole('button', { name: /Next exercise/ }).click();
    await expect(page.getByRole('heading', { name: 'Row' })).toBeVisible();
    await page.getByRole('button', { name: 'Finish workout' }).click();
    await page.getByRole('button', { name: 'Confirm finish' }).click();
    await expect(page.getByRole('heading', { name: /Workout done/ })).toBeVisible();
    await expect(page.getByText('525')).toBeVisible();
    await waitForFonts(page);
    await accessible(page);
    await page.screenshot({
      path: `../../docs/design/r22-workout-finish-${width}.png`,
      fullPage: true,
    });
    await page.evaluate(() => (document.documentElement.style.fontSize = '32px'));
    await accessible(page);
  });
}
