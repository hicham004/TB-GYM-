import AxeBuilder from '@axe-core/playwright';
import type { Page, Route } from '@playwright/test';
import { expect, json, mockSession, SIGNED_IN_USER, test, waitForFonts } from './support';
import { docsPicture } from './docs-pictures';

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
    weeklyChange: {
      methodKey: 'BodyweightChangeWeeklyMean',
      methodVersion: '1.0',
      fromDate: '2026-09-21',
      firstWeekStart: '2026-09-21',
      firstWeekMeanKilograms: 82.4,
      firstWeekObservedDayCount: 1,
      latestWeekStart: '2026-09-28',
      latestWeekMeanKilograms: 81.5,
      latestWeekObservedDayCount: 1,
      deltaKilograms: -0.9,
      displayDelta: -0.9,
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
    await docsPicture(page, `r23-progress-${width}.png`, { fullPage: true });
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
  coachNotes: null,
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
  // Last time differs from today's target, so the row shows which one it starts from (TRN-029).
  previousPerformance: {
    date: '2026-09-23',
    bestLoad: 95,
    unit: 'Kilogram',
    repetitions: 6,
    rpe: 8,
    sets: [{ position: 1, repetitions: 6, load: 95, loadUnit: 'Kilogram', rpe: 8 }],
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
// Notes plan N6a: a last time + step set (TRN-032), 10 reps at 7 kg to start and 2 kg a step, done
// at 5 kg × 12 last time. A workout of its own, so the r22 test keeps its fixture and its pictures.
const stepWorkout = {
  ...workout,
  sessionId: 'session-2',
  workoutExecutionId: 'workout-2',
  name: 'Upper Accessories',
  exercises: [
    {
      ...workoutExercise('Lateral raise', 'raise'),
      previousPerformance: {
        date: '2026-09-23',
        bestLoad: 5,
        unit: 'Kilogram',
        repetitions: 12,
        rpe: null,
        sets: [{ position: 1, repetitions: 12, load: 5, loadUnit: 'Kilogram', rpe: null }],
      },
      sets: [
        {
          ...workoutSet(1, 'raise'),
          prescribedRepetitionsMinimum: 10,
          prescribedRepetitionsMaximum: 10,
          prescribedLoad: 7,
          loadStrategy: 'LastTimeStep',
          loadStep: 2,
          prescribedTargetRpe: null,
        },
      ],
    },
  ],
};
const nothingUnfinished = {
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
};

test.describe('Workout player', () => {
  // Fast-forwarding the page clock through a rest skips a minute in which the realtime hub sends
  // nothing, so SignalR logs its server timeout and reconnects, as it does after a phone was locked.
  test.use({
    allowedConsoleErrors: {
      patterns: [/Server timeout elapsed without receiving a message from the server/],
    },
  });

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
      // The clock runs as usual until the rest below is fast-forwarded.
      await page.clock.install({ time: new Date('2026-09-30T08:30:00Z') });
      await page.goto('/training/today');
      await expect(page.getByRole('heading', { name: 'Back squat' })).toBeVisible();
      await expect(page.locator('.previous-performance')).toContainText('95 kg × 6');
      // The row starts at the coach's 100 kg × 5, not last time's 95 × 6.
      await expect(page.getByRole('spinbutton', { name: 'Actual load', exact: true })).toHaveValue(
        '100',
      );
      await expect(
        page.getByRole('spinbutton', { name: 'Actual repetitions', exact: true }),
      ).toHaveValue('5');
      await expect(page.getByRole('radio', { name: 'kg' })).toBeChecked();
      // The barbell (motion plan W11): Plates reads the row's 100 kg as 20 and 20 a side, and its
      // steppers move the sheet's own weight, never the set's.
      await page.getByRole('button', { name: 'Plates' }).click();
      const plates = page.getByRole('dialog', { name: 'Plates' });
      // The words once, visibly; the live region repeats them for a screen reader.
      const perSide = plates.locator('.per-side');
      await expect(perSide).toHaveText('Per side: 20, 20');
      await expect(plates.locator('.bar-line span')).toHaveText('20 kg bar');
      await plates.getByRole('button', { name: 'More weight' }).click();
      await expect(perSide).toHaveText('Per side: 20, 20, 1.25');
      await plates.getByRole('button', { name: 'Use 15 kg bar' }).click();
      await expect(perSide).toHaveText('Per side: 20, 20, 2.5, 1.25');
      await accessible(page);
      await plates.getByRole('button', { name: 'Close' }).click();
      await expect(plates).toHaveCount(0);
      await expect(page.getByRole('spinbutton', { name: 'Actual load', exact: true })).toHaveValue(
        '100',
      );
      // The player fills the screen: no tab bar over Finish workout.
      await expect(page.getByRole('navigation', { name: 'Client navigation' })).toHaveCount(0);
      await waitForFonts(page);
      await accessible(page);
      await docsPicture(page, `r22-workout-${width}.png`, { fullPage: true });
      // The set's More options row is the kit's fold: on the light card it reads in the card's ink
      // and rings in the brand, not in the player's dark tokens.
      await page.getByRole('button', { name: 'Log set' }).focus();
      // The target weight's tap (W11) is the next stop, then the fold.
      await page.keyboard.press('Tab');
      await expect(page.locator('.target-weight').first()).toBeFocused();
      await page.keyboard.press('Tab');
      const moreOptions = page.locator('.set-note summary');
      await expect(moreOptions).toBeFocused();
      await expect(moreOptions).toHaveCSS('color', 'rgb(20, 41, 30)');
      await expect(moreOptions).toHaveCSS('outline-color', 'rgb(21, 61, 51)');
      await page.getByRole('spinbutton', { name: 'Actual load', exact: true }).fill('105');
      await page.getByRole('button', { name: 'Log set' }).click();
      await expect(page.getByText('PR', { exact: true })).toBeVisible();
      await expect(page.getByRole('timer')).toBeVisible();
      await page.clock.fastForward(61_000);
      await expect(page.getByText('Rest is over', { exact: true })).toBeVisible();
      await accessible(page);
      await page.getByRole('button', { name: 'Dismiss' }).click();
      await page.getByRole('button', { name: /Next exercise/ }).click();
      await expect(page.getByRole('heading', { name: 'Row' })).toBeVisible();
      await page.getByRole('button', { name: 'Finish workout' }).click();
      await page.getByRole('button', { name: 'Confirm finish' }).click();
      await expect(page.getByRole('heading', { name: /Workout done/ })).toBeVisible();
      await expect(page.getByText('525')).toBeVisible();
      await waitForFonts(page);
      await accessible(page);
      await docsPicture(page, `r22-workout-finish-${width}.png`, { fullPage: true });
      await page.evaluate(() => (document.documentElement.style.fontSize = '32px'));
      await accessible(page);
    });
  }

  // Notes plan N6a, TRN-029 v2: a last time + step set counts only with the reps the client did, so
  // its reps box starts empty and ✓ asks for them before anything is sent (decision 22).
  test('A last time + step set at 390px asks for the reps before it logs', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const puts: string[] = [];
    page.on('request', (request) => {
      if (request.method() === 'PUT') puts.push(new URL(request.url()).pathname);
    });
    await session(page, {
      'GET /api/training/me/today': (route) =>
        json(route, 200, {
          isAllowed: true,
          accessReason: 'Granted',
          localDate: '2026-09-30',
          workouts: [stepWorkout],
        }),
      'GET /api/training/me/upcoming': (route) => json(route, 200, nothingUnfinished),
      'PUT /api/training/me/workouts/workout-2/sets/set-raise': (route) =>
        json(route, 200, {
          workoutExecutionId: 'workout-2',
          executionVersion: 2,
          setPerformanceId: 'set-raise',
          actualRepetitions: 10,
          actualLoad: 7,
          actualLoadUnit: 'Kilogram',
          actualRpe: null,
          actualRir: null,
          isCompleted: true,
          clientNote: null,
          isPersonalRecord: false,
          personalRecordRuleKey: null,
          personalRecordRuleVersion: null,
        }),
    });
    await page.clock.install({ time: new Date('2026-09-30T08:20:00Z') });
    await page.goto('/training/today');
    await expect(page.getByRole('heading', { name: 'Lateral raise' })).toBeVisible();
    const reps = page.getByRole('spinbutton', { name: 'Actual repetitions', exact: true });
    // Neither the coach's 10 nor last time's 12; the weight starts at the coach's 7 kg.
    await expect(reps).toHaveValue('');
    await expect(page.getByRole('spinbutton', { name: 'Actual load', exact: true })).toHaveValue(
      '7',
    );
    await expect(page.locator('.set-previous')).toHaveText('Last time 5 kg × 12');
    // The Target line stays the client's; the step is the coach's (decision 21).
    const target = page.locator('.prescription');
    await expect(target).toContainText('Target: 10 reps · 7 kg');
    await expect(target).not.toContainText(/last time|\+/i);

    await page.getByRole('button', { name: 'Log set' }).click();
    const summary = page.locator('#training-error-summary');
    await expect(summary).toHaveText('Type your reps first.');
    await expect(summary).toBeFocused();
    await expect(page.locator('.set-card .player-error')).toHaveText('Type your reps first.');
    await expect(reps).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByRole('timer')).toHaveCount(0);
    expect(puts).toEqual([]);
    await waitForFonts(page);
    await accessible(page);
    await page.evaluate(() => (document.documentElement.style.fontSize = '32px'));
    await accessible(page);
    await page.evaluate(() => (document.documentElement.style.fontSize = ''));

    await reps.fill('10');
    await expect(reps).not.toHaveAttribute('aria-invalid');
    const sent = page.waitForRequest(
      (request) => request.method() === 'PUT' && request.url().endsWith('/sets/set-raise'),
    );
    await page.getByRole('button', { name: 'Log set' }).click();
    expect((await sent).postDataJSON()).toMatchObject({
      repetitions: 10,
      load: 7,
      loadUnit: 'Kilogram',
      isCompleted: true,
      version: 1,
    });
    await expect(page.getByText('Set saved.')).toBeVisible();
    await expect(summary).toHaveText('');
    await expect(page.locator('.logged-set')).toHaveText('7 kg × 10');
    await expect(page.getByRole('timer')).toBeVisible();
    expect(puts).toEqual(['/api/training/me/workouts/workout-2/sets/set-raise']);
    await accessible(page);
    await page.evaluate(() => (document.documentElement.style.fontSize = '32px'));
    await accessible(page);
  });

  // Notes plan N6c, STR-020: the coach applied 2 kg on the raise after every set of 12 was done, so the workout
  // says why under Last time; the Target line stays the client's own.
  for (const width of [390, 1440]) {
    test(`A weight the coach applied says why at ${width}px (N6c)`, async ({ page }) => {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      const applied = {
        ...stepWorkout,
        exercises: [
          {
            ...stepWorkout.exercises[0],
            weightNote: {
              move: 'StepUp',
              increases: [2],
              unit: 'Kilogram',
              lastTimeDay: '2026-09-23',
              workingSets: 1,
              repetitionsAsked: 12,
              reason: null,
              exertionDisplay: 'Rpe',
            },
          },
        ],
      };
      await session(page, {
        'GET /api/training/me/today': (route) =>
          json(route, 200, {
            isAllowed: true,
            accessReason: 'Granted',
            localDate: '2026-09-30',
            workouts: [applied],
          }),
        'GET /api/training/me/upcoming': (route) => json(route, 200, nothingUnfinished),
      });
      await page.clock.install({ time: new Date('2026-09-30T08:20:00Z') });
      await page.goto('/training/today');
      await expect(page.getByRole('heading', { name: 'Lateral raise' })).toBeVisible();
      const note = page.locator('.weight-note');
      await expect(note).toHaveText('Up 2 kg · 1 × 12 done on Wed 23 Sep');
      await expect(note.locator('strong')).toHaveText('Up 2 kg');
      await expect(page.locator('.prescription')).not.toContainText(/Up 2|last time|\+/i);
      await waitForFonts(page);
      await accessible(page);
      await page.evaluate(() => (document.documentElement.style.fontSize = '32px'));
      await accessible(page);
    });
  }
});
