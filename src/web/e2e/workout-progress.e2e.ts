import AxeBuilder from '@axe-core/playwright';
import type { Page, Route } from '@playwright/test';
import type {
  OwnWorkoutExerciseView,
  OwnWorkoutSetView,
  OwnWorkoutView,
  PoolExerciseView,
  RecordSetActualRequest,
} from '../src/app/core/api/generated';
import { finishedProfile } from '../src/testing/intake-fixtures';
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

// Notes plan N9b3, TRN-033: a trainee of TB Gym's own space logs a workout of their own in the player.
// Nothing is prescribed, so nothing is targeted; its exercises come from TB Gym's pool, picked in the
// player's dark sheet, each with one empty set to log.

/** TB Gym's own coaching space, whose trainees train with no coach (notes plan N9a2). */
const house = {
  tenantId: '00000000-0000-4000-8000-0000000000f1',
  tenantName: 'TB Gym coaching space',
  tenantSlug: 'tb-gym-coaching-space',
  role: 'Client',
};
const OWN = 'own-1';
const OWN_ROUTE = `/api/training/me/workouts/${OWN}`;
const poolExercise = (
  id: string,
  name: string,
  equipment: PoolExerciseView['equipment'],
  movementPattern: PoolExerciseView['movementPattern'],
  muscle: PoolExerciseView['muscles'][number]['muscle'],
  demos: PoolExerciseView['demos'] = [],
): PoolExerciseView => ({
  id,
  name,
  classification: 'Strength',
  typeName: null,
  equipment,
  movementPattern,
  muscles: [{ muscle, role: 'Primary' }],
  instructions: null,
  demos,
});
/** TB Gym's pool as `GET /api/exercise-pool` answers it, in name order (LIB-006). */
const POOL = [
  poolExercise('goblet', 'Goblet squat', 'Dumbbell', 'Squat', 'Quadriceps', [
    { mediaAssetId: 'media-goblet', kind: 'VideoLink' },
  ]),
  poolExercise('row', 'Seated cable row', 'Cable', 'HorizontalPull', 'Back'),
];
/** A set of the row `row` names (see `ownExercise`): `set-goblet-1`, or `set-goblet-2-1` in a second row. */
const ownSet = (row: string, position: number, logged = false): OwnWorkoutSetView => ({
  performanceId: `set-${row}-${position}`,
  position,
  actualRepetitions: logged ? 10 : null,
  actualLoad: logged ? 20 : null,
  actualLoadUnit: logged ? 'Kilogram' : null,
  actualRpe: null,
  actualRir: null,
  isCompleted: logged,
  clientNote: null,
});
/**
 * A row of the workout. The server gives each row an id of its own, so an exercise added a second time
 * is a second row: `row` is the exercise's id for its first (`perf-goblet`), with a count after it for
 * the next (`perf-goblet-2`).
 */
const ownExercise = (
  exercise: PoolExerciseView,
  position: number,
  sets: OwnWorkoutSetView[] = [],
  row: string = exercise.id,
): OwnWorkoutExerciseView => ({
  performanceId: `perf-${row}`,
  exerciseId: exercise.id,
  exerciseName: exercise.name,
  position,
  mediaAssetIds: exercise.demos.map((demo) => demo.mediaAssetId),
  previousPerformance: null,
  sets,
});
/** The stored name is "Workout" (OwnWorkoutRule.Name); it runs on the house's day. */
const ownWorkout = (
  exercises: OwnWorkoutExerciseView[] = [],
  version = 1,
  notes: OwnWorkoutView['notes'] = [],
): OwnWorkoutView => ({
  workoutExecutionId: OWN,
  name: 'Workout',
  date: '2026-09-30',
  status: 'InProgress',
  startedAtUtc: '2026-09-30T08:00:00Z',
  completedAtUtc: null,
  version,
  exercises,
  notes,
});
/** A trainee's upcoming read: no program and nothing unfinished (CLI-026). */
const noProgram = {
  ...nothingUnfinished,
  hasAssignedProgram: false,
  hasVisibleSessions: false,
  todayCoverage: { activeBlock: null, nextBlockStartDate: null },
};

/**
 * N9b2's routes for one workout of one's own, as the server answers them: every change answers the
 * whole workout on its next version, Today's read carries it while it runs, and the pool is searched by
 * name, a page at a time. Records each write's route and body, each pool read's query, and Today's
 * reads. `refuseNextAdd` makes the next exercise added meet a stale version, as when another phone
 * changed the workout first; `holdNextAdd` keeps the next one unanswered until it is let go, as on a
 * slow phone. An exercise added again is a second row with ids of its own (`perf-goblet-2`).
 */
function ownServer(start: OwnWorkoutView | null = null) {
  let workout = start;
  let todayReads = 0;
  let refuseNextAdd = false;
  let held: Promise<void> | null = null;
  /** The rows made of each exercise so far, so a row's id is never given twice. */
  const rowsMade = new Map<string, number>();
  for (const item of start?.exercises ?? []) {
    rowsMade.set(item.exerciseId, (rowsMade.get(item.exerciseId) ?? 0) + 1);
  }
  const writes: { route: string; body: unknown }[] = [];
  const poolReads: string[] = [];
  const current = (): OwnWorkoutView => {
    if (!workout) throw new Error('No workout of one’s own is running.');
    return workout;
  };
  const written = (route: Route) =>
    writes.push({
      route: `${route.request().method()} ${new URL(route.request().url()).pathname}`,
      body: route.request().postDataJSON(),
    });
  const changed = (exercises: OwnWorkoutExerciseView[]): OwnWorkoutView => ({
    ...current(),
    version: Number(current().version) + 1,
    exercises,
  });
  const answer = (route: Route, next: OwnWorkoutView) => {
    workout = next;
    return json(route, 200, next);
  };
  const handlers: Record<string, (route: Route) => Promise<void>> = {
    'GET /api/training/me/today': (route) => {
      todayReads += 1;
      return json(route, 200, {
        isAllowed: true,
        accessReason: 'Granted',
        localDate: '2026-09-30',
        workouts: [],
        ownWorkout: workout?.status === 'InProgress' ? workout : null,
      });
    },
    'GET /api/training/me/upcoming': (route) => json(route, 200, noProgram),
    'GET /api/exercise-pool': (route) => {
      const asked = new URL(route.request().url()).searchParams;
      poolReads.push(asked.toString());
      const text = (asked.get('query') ?? '').toLowerCase();
      const found = POOL.filter((exercise) => exercise.name.toLowerCase().includes(text));
      const skip = Number(asked.get('skip') ?? 0);
      return json(route, 200, {
        isAllowed: true,
        accessReason: 'Granted',
        total: found.length,
        items: found.slice(skip, skip + Number(asked.get('take') ?? 50)),
      });
    },
    'POST /api/training/me/workouts': (route) => {
      written(route);
      return answer(route, ownWorkout());
    },
    [`POST ${OWN_ROUTE}/exercises`]: async (route) => {
      written(route);
      if (held) {
        const answerWhenLetGo = held;
        held = null;
        await answerWhenLetGo;
      }
      if (refuseNextAdd) {
        refuseNextAdd = false;
        workout = { ...current(), version: Number(current().version) + 1 };
        return json(route, 409, {
          code: 'concurrency_conflict',
          message: 'Training data was changed by another request.',
        });
      }
      const { exerciseId } = route.request().postDataJSON() as { exerciseId: string };
      const exercise = POOL.find((item) => item.id === exerciseId)!;
      const made = (rowsMade.get(exerciseId) ?? 0) + 1;
      rowsMade.set(exerciseId, made);
      const row = made === 1 ? exerciseId : `${exerciseId}-${made}`;
      const exercises = current().exercises;
      return answer(
        route,
        changed([...exercises, ownExercise(exercise, exercises.length + 1, [], row)]),
      );
    },
    [`POST ${OWN_ROUTE}/complete`]: (route) => {
      written(route);
      const sets = current().exercises.flatMap((exercise) => exercise.sets);
      const done = sets.filter((set) => set.isCompleted);
      const finished: OwnWorkoutView = {
        ...current(),
        status: 'Completed',
        completedAtUtc: '2026-09-30T08:25:00Z',
        version: Number(current().version) + 1,
      };
      workout = finished;
      return json(route, 200, {
        id: OWN,
        status: 'Completed',
        startedAtUtc: finished.startedAtUtc,
        completedAtUtc: finished.completedAtUtc,
        version: finished.version,
        finishSummary: {
          durationSeconds: 1500,
          completedSetCount: done.length,
          totalSetCount: sets.length,
          volume: done.length
            ? [
                {
                  unit: 'Kilogram',
                  loadTimesRepetitions: done.reduce(
                    (total, set) => total + Number(set.actualLoad) * Number(set.actualRepetitions),
                    0,
                  ),
                },
              ]
            : [],
          personalRecords: [],
        },
      });
    },
  };
  // Each pool exercise's first row and a second, added again.
  for (const row of POOL.flatMap((exercise) => [exercise.id, `${exercise.id}-2`])) {
    const performanceId = `perf-${row}`;
    handlers[`POST ${OWN_ROUTE}/exercises/${performanceId}/sets`] = (route) => {
      written(route);
      return answer(
        route,
        changed(
          current().exercises.map((item) =>
            item.performanceId === performanceId
              ? { ...item, sets: [...item.sets, ownSet(row, item.sets.length + 1)] }
              : item,
          ),
        ),
      );
    };
    handlers[`DELETE ${OWN_ROUTE}/exercises/${performanceId}`] = (route) => {
      written(route);
      return answer(
        route,
        changed(current().exercises.filter((item) => item.performanceId !== performanceId)),
      );
    };
    for (const position of [1, 2, 3]) {
      const setId = `set-${row}-${position}`;
      handlers[`DELETE ${OWN_ROUTE}/sets/${setId}`] = (route) => {
        written(route);
        return answer(
          route,
          changed(
            current().exercises.map((item) => ({
              ...item,
              sets: item.sets.filter((set) => set.performanceId !== setId),
            })),
          ),
        );
      };
      handlers[`PUT ${OWN_ROUTE}/sets/${setId}`] = (route) => {
        written(route);
        const sent = route.request().postDataJSON() as RecordSetActualRequest;
        const logged = {
          actualRepetitions: sent.repetitions,
          actualLoad: sent.load,
          actualLoadUnit: sent.loadUnit,
          actualRpe: sent.rpe,
          actualRir: sent.rir,
          isCompleted: sent.isCompleted,
          clientNote: sent.clientNote,
        };
        workout = changed(
          current().exercises.map((item) => ({
            ...item,
            sets: item.sets.map((set) =>
              set.performanceId === setId ? { ...set, ...logged } : set,
            ),
          })),
        );
        return json(route, 200, {
          workoutExecutionId: OWN,
          executionVersion: workout.version,
          setPerformanceId: setId,
          ...logged,
          isPersonalRecord: false,
        });
      };
    }
  }
  return {
    handlers,
    writes,
    poolReads,
    todayReads: () => todayReads,
    refuseNextAdd: () => {
      refuseNextAdd = true;
    },
    /** Keeps the next exercise added unanswered; the function returned lets it go. */
    holdNextAdd: (): (() => void) => {
      let letGo: (() => void) | undefined;
      held = new Promise<void>((resolve) => (letGo = resolve));
      return () => letGo?.();
    },
  };
}

/** A trainee of the house signed in: Training alone is in their plan, and they coach themselves. */
async function traineeSession(
  page: Page,
  extra: Record<string, (route: Route) => Promise<void> | void>,
): Promise<void> {
  await mockSession(page, {
    memberships: [house],
    user: { ...SIGNED_IN_USER, displayName: 'Nour Khalil' },
    extra: {
      'GET /api/client-access/me': (route) =>
        json(
          route,
          200,
          ['Training', 'Nutrition', 'CheckIns', 'Messaging', 'ResourceLibrary', 'Sessions'].map(
            (feature) => ({
              feature,
              isAllowed: feature === 'Training',
              reason: feature === 'Training' ? 'Granted' : 'NoEntitlement',
            }),
          ),
        ),
      'GET /api/client-profile/me': (route) =>
        json(route, 200, finishedProfile({ selfDirected: true })),
      ...extra,
    },
  });
}

/** The sheet or dialog named `name` is drawn on the night's colours, as everything over the player is. */
async function expectDark(page: Page, name: string): Promise<void> {
  const pane = page.locator('.tb-modal-pane').filter({ has: page.getByRole('dialog', { name }) });
  await expect(pane).toHaveAttribute('data-mode', 'dark');
  await expect(pane.locator('app-modal-surface')).toHaveCSS('background-color', 'rgb(22, 30, 27)');
}

/**
 * What `selector` finds that runs past the screen's sides or past its own box. At 200% text a control
 * wraps or grows; it never pushes anything off the screen (WCAG 1.4.10).
 */
function pastTheEdge(page: Page, selector: string): Promise<string[]> {
  return page.evaluate((selector) => {
    const width = document.documentElement.clientWidth;
    return [...document.querySelectorAll<HTMLElement>(selector)]
      .filter((element) => {
        const box = element.getBoundingClientRect();
        return (
          box.left < -1 || box.right > width + 1 || element.scrollWidth > element.clientWidth + 1
        );
      })
      .map(
        (element) =>
          `${element.tagName.toLowerCase()}.${element.className} "${element.textContent?.trim().slice(0, 40)}"`,
      );
  }, selector);
}

test.describe('A workout of one’s own (N9b3)', () => {
  for (const width of [390, 1440]) {
    test(`at ${width}px a trainee starts one, adds an exercise from TB Gym’s pool, logs it and finishes`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      const server = ownServer();
      let profileReads = 0;
      await traineeSession(page, {
        ...server.handlers,
        'GET /api/client-profile/me': (route) => {
          profileReads += 1;
          return json(route, 200, finishedProfile({ selfDirected: true }));
        },
      });
      await page.clock.install({ time: new Date('2026-09-30T08:10:00Z') });
      await page.goto('/training/today');

      // Nothing running and no program: a trainee is offered a workout of their own, never a coach's line.
      await expect(page.getByRole('heading', { name: 'No workout in progress' })).toBeVisible();
      await expect(
        page.getByText('Start one, add exercises from TB Gym’s pool and log each set as you go.'),
      ).toBeVisible();
      await expect(page.getByText('Nothing assigned yet')).toHaveCount(0);
      await waitForFonts(page);
      await accessible(page);
      await page.getByRole('button', { name: 'Start a workout' }).click();

      await expect(page.locator('.player-top .eyebrow')).toHaveText('YOUR OWN WORKOUT');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Workout');
      await expect(page.getByRole('heading', { name: 'No exercises yet' })).toBeVisible();
      await expect(
        page.getByText('Add your first exercise from TB Gym’s pool, then log its sets.'),
      ).toBeVisible();
      await expect(page.locator('.save-status')).toContainText('Workout started.');
      // The Start button went with the empty state: focus moves to the first thing to do.
      await expect(page.getByRole('button', { name: 'Add an exercise' })).toBeFocused();
      expect(server.writes).toEqual([{ route: 'POST /api/training/me/workouts', body: {} }]);
      expect(profileReads).toBe(1);
      await accessible(page);

      // The pool in the kit's sheet, dark over the player.
      await page.getByRole('button', { name: 'Add an exercise' }).click();
      const sheet = page.getByRole('dialog', { name: 'Add an exercise' });
      await expect(sheet.locator('button.pick')).toHaveCount(2);
      await expectDark(page, 'Add an exercise');
      await expect(
        sheet.getByRole('button', { name: 'Add Goblet squat', exact: true }),
      ).toBeVisible();
      await expect(
        sheet.getByRole('button', { name: 'Add Seated cable row', exact: true }),
      ).toBeVisible();
      await expect(sheet.locator('.detail')).toHaveText(['Dumbbell · Quadriceps', 'Cable · Back']);
      const demo = sheet.getByRole('button', { name: 'Watch the Goblet squat demo' });
      await expect(demo).toBeVisible();
      // A client's thumb (plan §2 rule 6): the demo beside a row is 44 px a side, measured as drawn.
      const demoBox = await demo.boundingBox();
      expect(demoBox, 'the demo button is drawn').not.toBeNull();
      expect(demoBox!.width).toBeGreaterThanOrEqual(44);
      expect(demoBox!.height).toBeGreaterThanOrEqual(44);
      expect(server.poolReads).toEqual(['skip=0&take=50']);
      await accessible(page);

      // A search goes to the server; a cleared box shows the pool again without asking.
      const search = sheet.getByRole('searchbox', { name: 'Search exercises' });
      await search.fill('row');
      await expect(sheet.locator('button.pick')).toHaveCount(1);
      await expect(sheet.locator('button.pick')).toHaveAccessibleName('Add Seated cable row');
      await search.fill('zzz');
      await expect(sheet.getByText('No exercise matches “zzz”.')).toBeVisible();
      await sheet.getByRole('button', { name: 'Show all exercises' }).click();
      await expect(sheet.locator('button.pick')).toHaveCount(2);
      await expect(search).toBeFocused();
      expect(server.poolReads).toEqual([
        'skip=0&take=50',
        'skip=0&take=50&query=row',
        'skip=0&take=50&query=zzz',
      ]);

      // One press adds the exercise, then one empty set to log; the picker stays open for the next.
      const setAdded = page.waitForRequest(
        (request) =>
          request.method() === 'POST' && request.url().endsWith('/exercises/perf-goblet/sets'),
      );
      await sheet.getByRole('button', { name: 'Add Goblet squat', exact: true }).click();
      await setAdded;
      await expect(sheet.getByRole('button', { name: 'Add Goblet squat again' })).toBeVisible();
      await expect(sheet.locator('.mark.added')).toHaveText('Added');
      await expect(sheet.locator('p.tb-visually-hidden[role="status"]')).toHaveText(
        'Goblet squat added.',
      );
      expect(server.writes.slice(1)).toEqual([
        { route: `POST ${OWN_ROUTE}/exercises`, body: { exerciseId: 'goblet', version: 1 } },
        { route: `POST ${OWN_ROUTE}/exercises/perf-goblet/sets`, body: { version: 2 } },
      ]);
      await sheet.getByRole('button', { name: 'Done' }).click();
      await expect(sheet).toHaveCount(0);

      // Nothing is prescribed, so no target; kg or lb is never assumed (TRN-016).
      await expect(page.getByRole('heading', { level: 2, name: 'Goblet squat' })).toBeVisible();
      await expect(page.getByText('EXERCISE 1 OF 1')).toBeVisible();
      await expect(page.locator('.set-card')).toHaveCount(1);
      await expect(page.locator('.prescription')).toHaveCount(0);
      await expect(page.getByText('Target:')).toHaveCount(0);
      await expect(page.getByRole('radio', { name: 'kg' })).not.toBeChecked();
      await expect(page.getByRole('radio', { name: 'lb' })).not.toBeChecked();
      await expect(
        page.getByRole('group', { name: 'Sets of Goblet squat' }).getByRole('button'),
      ).toHaveText(['Add set', 'Remove last set']);
      await expect(page.getByRole('button', { name: 'Remove exercise' })).toBeVisible();
      await accessible(page);

      // Finishing with nothing logged is asked about in its own words: no discard exists.
      await page.getByRole('button', { name: 'Finish workout' }).click();
      const question = page.locator('.finish-confirmation');
      await expect(question).toContainText(
        'Nothing is logged yet. If you finish now, this workout stays in your history with no sets, and you can’t change it afterwards.',
      );
      await expect(question).not.toContainText('sets logged');
      await accessible(page);
      await question.getByRole('button', { name: 'Keep training' }).click();
      await expect(question).toHaveCount(0);

      await page.getByRole('radio', { name: 'kg' }).check();
      await page.getByRole('spinbutton', { name: 'Actual load', exact: true }).fill('20');
      await page.getByRole('spinbutton', { name: 'Actual repetitions', exact: true }).fill('10');
      const logged = page.waitForRequest(
        (request) => request.method() === 'PUT' && request.url().endsWith('/sets/set-goblet-1'),
      );
      await page.getByRole('button', { name: 'Log set' }).click();
      expect((await logged).postDataJSON()).toMatchObject({
        repetitions: 10,
        load: 20,
        loadUnit: 'Kilogram',
        isCompleted: true,
        version: 3,
      });
      await expect(page.locator('.save-status')).toContainText('Set saved.');
      await expect(page.locator('.logged-set')).toHaveText('20 kg × 10');
      // No rest is prescribed, so none starts.
      await expect(page.getByRole('timer')).toHaveCount(0);

      // With a set logged the question is the usual one.
      await page.getByRole('button', { name: 'Finish workout' }).click();
      await expect(question).toContainText(
        '1 of 1 sets logged. You can’t change this workout afterwards.',
      );
      await expect(question).not.toContainText('Nothing is logged yet');
      const finished = page.waitForRequest(
        (request) => request.method() === 'POST' && request.url().endsWith(`${OWN_ROUTE}/complete`),
      );
      await question.getByRole('button', { name: 'Confirm finish' }).click();
      expect((await finished).postDataJSON()).toEqual({ version: 4 });
      await expect(page.getByRole('heading', { name: /Workout done/ })).toBeVisible();
      const summary = page.getByRole('region', { name: 'Workout summary' });
      await expect(summary.locator('[data-stat="sets"] strong')).toHaveText('1 / 1');
      await expect(summary.locator('[data-stat="volume"] strong')).toHaveText('200');
      await waitForFonts(page);
      await accessible(page);
      await page.screenshot({
        path: test.info().outputPath(`n9b3-own-finish-${width}.png`),
        fullPage: true,
      });
    });
  }

  test('at 200% text the picker and a set’s buttons stay on a phone’s screen', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const server = ownServer(ownWorkout([ownExercise(POOL[0], 1, [ownSet('goblet', 1)])], 3));
    await traineeSession(page, server.handlers);
    await page.clock.install({ time: new Date('2026-09-30T08:10:00Z') });
    await page.goto(`/training/today?sessionId=${OWN}`);
    await expect(page.getByRole('heading', { level: 2, name: 'Goblet squat' })).toBeVisible();
    await waitForFonts(page);
    await page.evaluate(() => (document.documentElement.style.fontSize = '32px'));

    await expect(
      page.getByRole('group', { name: 'Sets of Goblet squat' }).getByRole('button'),
    ).toHaveText(['Add set', 'Remove last set']);
    await page.screenshot({ path: test.info().outputPath('n9b3-own-200-player.png') });
    expect
      .soft(
        await pastTheEdge(page, '.own-sets, .own-sets button, .own-add, .exercise-actions button'),
      )
      .toEqual([]);
    await accessible(page);

    // The pool over a workout that already holds an exercise: its row says so ("In this workout").
    await page.getByRole('button', { name: 'Add an exercise' }).click();
    const sheet = page.getByRole('dialog', { name: 'Add an exercise' });
    await expect(sheet.locator('button.pick')).toHaveCount(2);
    await expect(sheet.getByRole('button', { name: 'Add Goblet squat again' })).toBeVisible();
    const picker =
      '[role="dialog"], .tb-modal__header, .tb-modal__body, .tb-modal__footer, .tb-modal__footer button, app-pool-picker .search, app-pool-picker li, app-pool-picker button, app-pool-picker .name, app-pool-picker .detail';
    await page.screenshot({ path: test.info().outputPath('n9b3-own-200-picker.png') });
    expect.soft(await pastTheEdge(page, picker), 'with “In this workout”').toEqual([]);
    await accessible(page);

    // An exercise added while the picker is open is marked "Added", and its row keeps its name too.
    await sheet.getByRole('button', { name: 'Add Seated cable row', exact: true }).click();
    await expect(sheet.locator('.mark.added')).toHaveText('Added');
    await page.screenshot({ path: test.info().outputPath('n9b3-own-200-picker-added.png') });
    expect.soft(await pastTheEdge(page, picker), 'with “Added”').toEqual([]);
    await accessible(page);

    // Added again once the first has its set, the mark counts, its widest: it still wraps on the row,
    // never past it.
    await expect(sheet.locator('p.tb-visually-hidden[role="status"]')).toHaveText(
      'Seated cable row added.',
    );
    await sheet.getByRole('button', { name: 'Add Seated cable row again' }).click();
    await expect(sheet.locator('.mark.added')).toHaveText('Added ×2');
    await page.screenshot({ path: test.info().outputPath('n9b3-own-200-picker-added-2.png') });
    expect.soft(await pastTheEdge(page, picker), 'with “Added ×2”').toEqual([]);
    await accessible(page);
  });

  test('the same exercise picked twice is marked “Added ×2”, said again, and each comes with a set of its own', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const server = ownServer(ownWorkout());
    await traineeSession(page, server.handlers);
    await page.clock.install({ time: new Date('2026-09-30T08:10:00Z') });
    await page.goto(`/training/today?sessionId=${OWN}`);
    await expect(page.getByRole('heading', { name: 'No exercises yet' })).toBeVisible();

    await page.getByRole('button', { name: 'Add an exercise' }).click();
    const sheet = page.getByRole('dialog', { name: 'Add an exercise' });
    await expect(sheet.locator('button.pick')).toHaveCount(2);
    const said = sheet.locator('p.tb-visually-hidden[role="status"]');
    await sheet.getByRole('button', { name: 'Add Goblet squat', exact: true }).click();
    await expect(sheet.locator('.mark.added')).toHaveText('Added');
    await expect(said).toHaveText('Goblet squat added.');

    // A second press, once the first has its set, adds a second row: seen on the row and heard.
    await sheet.getByRole('button', { name: 'Add Goblet squat again' }).click();
    await expect(sheet.locator('.mark.added')).toHaveText('Added ×2');
    await expect(said).toHaveText('Goblet squat added again.');
    expect(server.writes).toEqual([
      { route: `POST ${OWN_ROUTE}/exercises`, body: { exerciseId: 'goblet', version: 1 } },
      { route: `POST ${OWN_ROUTE}/exercises/perf-goblet/sets`, body: { version: 2 } },
      { route: `POST ${OWN_ROUTE}/exercises`, body: { exerciseId: 'goblet', version: 3 } },
      { route: `POST ${OWN_ROUTE}/exercises/perf-goblet-2/sets`, body: { version: 4 } },
    ]);
    await accessible(page);
    await sheet.getByRole('button', { name: 'Done' }).click();
    await expect(sheet).toHaveCount(0);

    // The player shows the last one added; each row holds the one set it came with.
    await expect(page.getByText('EXERCISE 2 OF 2')).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Goblet squat' })).toBeVisible();
    await expect(page.locator('.set-card')).toHaveCount(1);
    await page.getByRole('button', { name: 'Previous exercise' }).click();
    await expect(page.getByText('EXERCISE 1 OF 2')).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Goblet squat' })).toBeVisible();
    await expect(page.locator('.set-card')).toHaveCount(1);
  });

  test('two exercises picked before the first is answered each come with a set of their own', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const server = ownServer(ownWorkout());
    await traineeSession(page, server.handlers);
    await page.clock.install({ time: new Date('2026-09-30T08:10:00Z') });
    await page.goto(`/training/today?sessionId=${OWN}`);
    await expect(page.getByRole('heading', { name: 'No exercises yet' })).toBeVisible();

    await page.getByRole('button', { name: 'Add an exercise' }).click();
    const sheet = page.getByRole('dialog', { name: 'Add an exercise' });
    await expect(sheet.locator('button.pick')).toHaveCount(2);
    // On a slow phone: the second row is pressed while the first's answer is still on its way.
    const letGo = server.holdNextAdd();
    const firstSent = page.waitForRequest(
      (request) => request.method() === 'POST' && request.url().endsWith(`${OWN_ROUTE}/exercises`),
    );
    await sheet.getByRole('button', { name: 'Add Goblet squat', exact: true }).click();
    await firstSent;
    await sheet.getByRole('button', { name: 'Add Seated cable row', exact: true }).click();
    letGo();

    // Each change waits for the one before it; each set goes to the row its own press added.
    await expect.poll(() => server.writes.length).toBe(4);
    expect(server.writes).toEqual([
      { route: `POST ${OWN_ROUTE}/exercises`, body: { exerciseId: 'goblet', version: 1 } },
      { route: `POST ${OWN_ROUTE}/exercises`, body: { exerciseId: 'row', version: 2 } },
      { route: `POST ${OWN_ROUTE}/exercises/perf-goblet/sets`, body: { version: 3 } },
      { route: `POST ${OWN_ROUTE}/exercises/perf-row/sets`, body: { version: 4 } },
    ]);
    await expect(sheet.locator('.mark.added')).toHaveText(['Added', 'Added']);
    await expect(sheet.locator('p.tb-visually-hidden[role="status"]')).toHaveText(
      'Seated cable row added.',
    );
    await expect(sheet.locator('.problem')).toHaveCount(0);
    await sheet.getByRole('button', { name: 'Done' }).click();
    await expect(sheet).toHaveCount(0);

    // The player shows the last one added, and each has the one empty set it came with.
    await expect(page.getByText('EXERCISE 2 OF 2')).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Seated cable row' })).toBeVisible();
    await expect(page.locator('.set-card')).toHaveCount(1);
    await page.getByRole('button', { name: 'Previous exercise' }).click();
    await expect(page.getByText('EXERCISE 1 OF 2')).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Goblet squat' })).toBeVisible();
    await expect(page.locator('.set-card')).toHaveCount(1);
    await accessible(page);
  });

  test('a logged set or an exercise with one is taken away only when asked, and a noted exercise stays', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const note = {
      id: 'note-1',
      exercisePerformanceId: 'perf-row',
      authorUserId: SIGNED_IN_USER.id,
      authorRole: 'Client' as const,
      text: 'Seat on the fourth hole.',
      createdAtUtc: '2026-09-30T08:05:00Z',
    };
    const server = ownServer(
      ownWorkout(
        [
          ownExercise(POOL[0], 1, [ownSet('goblet', 1, true), ownSet('goblet', 2, true)]),
          ownExercise(POOL[1], 2, [ownSet('row', 1)]),
        ],
        5,
        [note],
      ),
    );
    await traineeSession(page, server.handlers);
    await page.clock.install({ time: new Date('2026-09-30T08:10:00Z') });
    await page.goto(`/training/today?sessionId=${OWN}`);
    await expect(page.getByRole('heading', { level: 2, name: 'Goblet squat' })).toBeVisible();
    await expect(page.locator('.logged-set')).toHaveText(['20 kg × 10', '20 kg × 10']);

    // The last set is logged, so it is asked about, in the dark, and "Keep it" sends nothing.
    await page.getByRole('button', { name: 'Remove last set' }).click();
    const askSet = page.getByRole('dialog', { name: 'Remove set 2?' });
    await expect(askSet).toContainText(
      'It’s logged. Once it’s removed, it’s gone from this workout.',
    );
    await expectDark(page, 'Remove set 2?');
    await accessible(page);
    await askSet.getByRole('button', { name: 'Keep it' }).click();
    await expect(askSet).toHaveCount(0);
    expect(server.writes).toEqual([]);

    await page.getByRole('button', { name: 'Remove last set' }).click();
    await page
      .getByRole('dialog', { name: 'Remove set 2?' })
      .getByRole('button', { name: 'Remove set' })
      .click();
    await expect(page.locator('.save-status')).toContainText('Set removed.');
    await expect(page.locator('.set-card')).toHaveCount(1);

    // The exercise still holds a logged set, which goes with it.
    await page.getByRole('button', { name: 'Remove exercise' }).click();
    const askExercise = page.getByRole('dialog', { name: 'Remove Goblet squat?' });
    await expect(askExercise).toContainText('Its logged set goes with it.');
    await expectDark(page, 'Remove Goblet squat?');
    await askExercise.getByRole('button', { name: 'Remove exercise' }).click();
    await expect(page.locator('.save-status')).toContainText('Goblet squat removed.');
    await expect(page.getByRole('heading', { level: 2, name: 'Seated cable row' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add an exercise' })).toBeFocused();

    // A note names the row, so it stays and the page says why; its set, not logged, goes unasked.
    await expect(page.locator('.own-stays')).toHaveText(
      'This exercise has a note, so it stays in this workout.',
    );
    await expect(page.getByRole('button', { name: 'Remove exercise' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Remove last set' }).click();
    await expect(page.locator('.own-no-sets')).toHaveText('No sets yet. Add one to log it.');
    await expect(page.getByRole('button', { name: 'Add set' })).toBeFocused();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.getByRole('button', { name: 'Add set' }).click();
    await expect(page.locator('.set-card')).toHaveCount(1);
    await expect(page.locator('.save-status')).toContainText('Set added.');
    expect(server.writes).toEqual([
      { route: `DELETE ${OWN_ROUTE}/sets/set-goblet-2`, body: { version: 5 } },
      { route: `DELETE ${OWN_ROUTE}/exercises/perf-goblet`, body: { version: 6 } },
      { route: `DELETE ${OWN_ROUTE}/sets/set-row-1`, body: { version: 7 } },
      { route: `POST ${OWN_ROUTE}/exercises/perf-row/sets`, body: { version: 8 } },
    ]);
    await accessible(page);
  });

  test.describe('a change the server refuses', () => {
    test.use({
      allowedConsoleErrors: { patterns: [/status of 409 .*\/api\/training\/me\/workouts\//] },
    });

    test('an exercise refused because the workout moved on says so in the picker, and the next press sends the new version', async ({
      page,
    }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      const server = ownServer(ownWorkout());
      server.refuseNextAdd();
      await traineeSession(page, server.handlers);
      await page.clock.install({ time: new Date('2026-09-30T08:10:00Z') });
      await page.goto(`/training/today?sessionId=${OWN}`);
      await expect(page.getByRole('heading', { name: 'No exercises yet' })).toBeVisible();
      const reads = server.todayReads();

      await page.getByRole('button', { name: 'Add an exercise' }).click();
      const sheet = page.getByRole('dialog', { name: 'Add an exercise' });
      await sheet.getByRole('button', { name: 'Add Seated cable row', exact: true }).click();
      // The workout is read again, so the words can say it is up to date. They sit with the search,
      // which stays in view while the list scrolls.
      const problem = sheet.locator('.top .problem');
      await expect(problem).toHaveText(
        'This workout changed on another phone or tab. It’s up to date now, so try again.',
      );
      await expect(problem).toHaveAttribute('role', 'alert');
      expect(server.todayReads()).toBe(reads + 1);
      await expect(
        sheet.getByRole('button', { name: 'Add Seated cable row', exact: true }),
      ).toBeVisible();
      await accessible(page);

      const setAdded = page.waitForRequest(
        (request) =>
          request.method() === 'POST' && request.url().endsWith('/exercises/perf-row/sets'),
      );
      await sheet.getByRole('button', { name: 'Add Seated cable row', exact: true }).click();
      await setAdded;
      await expect(sheet.getByRole('button', { name: 'Add Seated cable row again' })).toBeVisible();
      await expect(problem).toHaveCount(0);
      expect(server.writes.map((write) => write.body)).toEqual([
        { exerciseId: 'row', version: 1 },
        { exerciseId: 'row', version: 2 },
        { version: 3 },
      ]);
    });
  });
});
