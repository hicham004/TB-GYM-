import { ACCOUNTS, api, expect, memberships, requireLive, signIn, test } from './support';

/**
 * The workout player against a live API: start, log a set as prescribed and one edited, finish with
 * sets left, read the summary and find the workout in Training's history (TRN-019, TRN-029).
 *
 * A session can be started once, so the file takes the first demo client who still has a workout
 * today that is not finished (Maya first, then Sara and Jad on a rebuilt demo), resumes one already
 * in progress, and skips when every one of them has trained. Nothing depends on another spec's writes.
 */
requireLive();

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

interface SetView {
  performanceId: string | null;
  position: number;
  prescribedRepetitionsMinimum: number | null;
  prescribedLoad: number | null;
  prescribedLoadUnit: 'Kilogram' | 'Pound' | null;
  restSeconds: number | null;
  actualLoad: number | null;
  actualRepetitions: number | null;
  isCompleted: boolean;
}
interface ExerciseView {
  actualExerciseName: string;
  sets: SetView[];
}
interface WorkoutView {
  sessionId: string;
  name: string;
  status: string | null;
  workoutExecutionId: string | null;
  exercises: ExerciseView[];
}
interface TodayView {
  isAllowed: boolean;
  workouts: WorkoutView[];
}
interface HistoryItem {
  name: string;
  date: string;
  completedSetCount: number;
  totalSetCount: number;
  volume: { unit: string; loadTimesRepetitions: number }[];
  personalRecords: { exerciseName: string; load: number; repetitions: number }[];
}

type LivePage = Parameters<typeof signIn>[0];
const candidates = [ACCOUNTS.maya, ACCOUNTS.sara, ACCOUNTS.jad];

/** Signs in as the first candidate with a workout today that is not finished. */
async function signInWithOpenWorkout(page: LivePage) {
  for (const email of candidates) {
    await signIn(page, email);
    const tenantId = (await memberships(page))[0].tenantId;
    const today = await api<TodayView>(page, 'GET', '/api/training/me/today', { tenantId });
    expect(today.status).toBe(200);
    const workout = today.body.workouts.find((item) => item.status !== 'Completed');
    if (workout) {
      const exerciseIndex = workout.exercises.findIndex(
        (item) => item.sets.filter((set) => !set.isCompleted).length >= 2,
      );
      if (exerciseIndex >= 0) return { email, tenantId, workout, exerciseIndex };
    }
    await api(page, 'POST', '/api/auth/logout');
  }
  return null;
}

async function readWorkout(page: LivePage, tenantId: string, sessionId: string) {
  const today = await api<TodayView>(page, 'GET', '/api/training/me/today', { tenantId });
  return today.body.workouts.find((item) => item.sessionId === sessionId)!;
}

test('a client starts today’s workout, logs sets, finishes and finds it in history', async ({
  page,
}) => {
  test.setTimeout(300_000);
  page.on('dialog', (dialog) => void dialog.accept());
  const found = await signInWithOpenWorkout(page);
  test.skip(!found, 'Every demo client with a session today has already finished it.');
  const { tenantId, workout, exerciseIndex } = found!;
  const exercise = workout.exercises[exerciseIndex];
  const openSets = exercise.sets.filter((set) => !set.isCompleted);
  const firstSet = openSets[0];
  const secondSet = openSets[1];
  const firstIndex = exercise.sets.indexOf(firstSet);
  const secondIndex = exercise.sets.indexOf(secondSet);
  const totalSets = workout.exercises.reduce((sum, item) => sum + item.sets.length, 0);
  const alreadyStarted = !!workout.workoutExecutionId;

  const load = (index: number) =>
    page.getByRole('spinbutton', { name: 'Actual load', exact: true }).nth(index);
  const setCard = (index: number) => page.locator('.set-card').nth(index);
  const notice = page.locator('.save-status');
  const openPlayer = async () => {
    await page.goto('/training/today', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: workout.name })).toBeVisible();
  };
  const goToExercise = async () => {
    for (let i = 0; i < exerciseIndex; i++) {
      await page.getByRole('button', { name: /Next exercise/ }).click();
    }
    await expect(page.locator('.workout-exercise h2')).toHaveText(exercise.actualExerciseName);
  };

  await test.step('Today leads with the workout and opens the player', async () => {
    await page.goto('/');
    await expect(
      page.getByText(alreadyStarted ? /In progress|Started/ : 'Scheduled today'),
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: workout.name })).toBeVisible();
    await page
      .getByRole('link', { name: alreadyStarted ? 'Continue workout' : 'Open workout' })
      .click();
    await page.waitForURL((url) => url.pathname === '/training/today');
    await expect(page.getByRole('heading', { name: workout.name })).toBeVisible();
  });

  await test.step('Start workout: a set starts at the prescription (TRN-029)', async () => {
    if (!alreadyStarted) {
      await expect(load(0)).toBeDisabled();
      await page.getByRole('button', { name: 'Start workout' }).click();
      await expect(notice).toHaveText('Workout started.');
    }
    await goToExercise();
    const input = setCard(firstIndex).getByRole('spinbutton', { name: 'Actual load', exact: true });
    await expect(input).toBeEnabled();
    if (firstSet.prescribedLoad !== null) {
      await expect(input).toHaveValue(String(firstSet.prescribedLoad));
      await expect(
        page.getByRole('radio', { name: firstSet.prescribedLoadUnit === 'Pound' ? 'lb' : 'kg' }),
      ).toBeChecked();
    }
    if (firstSet.prescribedRepetitionsMinimum !== null) {
      await expect(
        setCard(firstIndex).getByRole('spinbutton', { name: 'Actual repetitions', exact: true }),
      ).toHaveValue(String(firstSet.prescribedRepetitionsMinimum));
    }
    await expect(setCard(firstIndex).locator('.prescription')).toContainText('Target:');
  });

  await test.step('One tap logs the set as prescribed and starts the rest', async () => {
    await setCard(firstIndex).getByRole('button', { name: 'Log set' }).click();
    await expect(notice).toHaveText(/Set saved\.|New personal record!/);
    const logged = setCard(firstIndex).locator('.logged-set');
    if (firstSet.prescribedLoad !== null)
      await expect(logged).toContainText(`${firstSet.prescribedLoad}`);
    if (firstSet.prescribedRepetitionsMinimum !== null) {
      await expect(logged).toContainText(`× ${firstSet.prescribedRepetitionsMinimum}`);
    }
    if ((firstSet.restSeconds ?? 0) > 0) {
      const timer = page.getByRole('timer');
      await expect(timer).toBeVisible();
      await timer.getByRole('button', { name: '+15 s' }).click();
      await timer.getByRole('button', { name: 'Skip' }).click();
      await expect(timer).toHaveCount(0);
    }
  });

  await test.step('An edited load is what the second set records', async () => {
    const edited = secondSet.prescribedLoad !== null ? secondSet.prescribedLoad + 2.5 : 20;
    const card = setCard(secondIndex);
    await card.getByRole('spinbutton', { name: 'Actual load', exact: true }).fill(String(edited));
    await card.getByRole('spinbutton', { name: 'Actual repetitions', exact: true }).fill('3');
    await card.getByRole('button', { name: 'Log set' }).click();
    await expect(notice).toHaveText(/Set saved\.|New personal record!/);
    await expect(card.locator('.logged-set')).toContainText(`${edited}`);
    await expect(card.locator('.logged-set')).toContainText('× 3');
    await page
      .getByRole('timer')
      .getByRole('button', { name: 'Skip' })
      .click()
      .catch(() => undefined);
    const saved = (await readWorkout(page, tenantId, workout.sessionId)).exercises[
      exerciseIndex
    ].sets.find((set) => set.position === secondSet.position)!;
    expect(saved.actualLoad).toBe(edited);
    expect(saved.actualRepetitions).toBe(3);
    expect(saved.isCompleted).toBe(true);
  });

  await test.step('A refused RPE keeps the set unlogged and the entries on the page', async () => {
    const third = openSets[2] ? setCard(exercise.sets.indexOf(openSets[2])) : null;
    if (third) {
      await third.getByText('More options').click();
      await third.getByRole('spinbutton', { name: 'Actual RPE' }).fill('8.3');
      await third.getByRole('button', { name: 'Log set' }).click();
      await expect(third.locator('.player-error')).toContainText('RPE must be between 5 and 10');
      await expect(third.getByRole('button', { name: 'Log set' })).toBeVisible();
    }
  });

  await test.step('A unit toggle must not block Finish (CLIENT-1)', async () => {
    // A fresh page first, so no typed draft of ours is pending: the toggle alone is under test.
    await openPlayer();
    await page.getByRole('radio', { name: 'lb' }).click();
    await page.getByRole('radio', { name: 'kg' }).click();
    await page.getByRole('button', { name: 'Finish workout' }).click();
    // Known defect: the toggle marks every set edited and Finish refuses. Soft, so the flow goes on.
    await expect
      .soft(page.locator('#training-error-summary'), 'a unit toggle alone must not be an edit')
      .not.toContainText('Save every edited set');
    // The confirmation only opens when Finish was not refused, so give the click a short leash.
    await page
      .getByRole('button', { name: 'Keep training' })
      .click({ timeout: 3_000 })
      .catch(() => undefined);
  });

  let summaryRecords: string[] = [];
  let loggedCount = 0;
  let volume = 0;
  await test.step('Finish with sets left: the confirmation counts them and the summary adds up', async () => {
    await openPlayer();
    const current = await readWorkout(page, tenantId, workout.sessionId);
    const completed = current.exercises
      .flatMap((item) => item.sets)
      .filter((set) => set.isCompleted);
    loggedCount = completed.length;
    volume = completed
      .filter((set) => set.actualLoad !== null && set.actualRepetitions !== null)
      .reduce((sum, set) => sum + set.actualLoad! * set.actualRepetitions!, 0);
    await page.getByRole('button', { name: 'Finish workout' }).click();
    const confirmation = page.locator('.finish-confirmation');
    await expect(confirmation).toContainText('Finish workout?');
    await expect(confirmation).toContainText(`${loggedCount} of ${totalSets} sets logged`);
    await page.getByRole('button', { name: 'Keep training' }).click();
    await expect(confirmation).toHaveCount(0);
    await page.getByRole('button', { name: 'Finish workout' }).click();
    await page.getByRole('button', { name: 'Confirm finish' }).click();
    const summary = page.locator('.finish-summary');
    await expect(summary).toBeVisible();
    await expect(summary).toContainText(`${loggedCount} / ${totalSets}`);
    if (volume > 0) await expect(summary).toContainText(String(volume));
    expect((await readWorkout(page, tenantId, workout.sessionId)).status).toBe('Completed');
    summaryRecords = await summary.locator('.pr-list li').allInnerTexts();
  });

  await test.step('Training lists the finished workout with its records; Today says Completed', async () => {
    const history = await api<{ items: HistoryItem[] }>(page, 'GET', '/api/training/me/history', {
      tenantId,
    });
    const item = history.body.items.find((entry) => entry.name === workout.name)!;
    expect(item.completedSetCount).toBe(loggedCount);
    if (volume > 0) expect(item.volume[0].loadTimesRepetitions).toBe(volume);
    expect(item.personalRecords.length).toBe(summaryRecords.length);
    await page.goto('/training/program');
    await expect(page.getByRole('heading', { name: 'Finished workouts' })).toBeVisible();
    await expect(page.getByText(workout.name).first()).toBeVisible();
    for (const record of item.personalRecords) {
      await expect(page.getByText(record.exerciseName).first()).toBeVisible();
    }
    await page.goto('/');
    await expect(page.getByText('Completed today')).toBeVisible();
    await expect(page.getByRole('link', { name: 'View workout' })).toBeVisible();
  });
});

test('the player keeps a trained client’s finished workout read-only', async ({ page }) => {
  await signIn(page, ACCOUNTS.rami);
  await page.goto('/training/today');
  await expect(page.getByText('Completed · read only')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Log set' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Finish workout' })).toHaveCount(0);
});

test('Today never calls a day a rest day on a guess (TRN-018)', async ({ page }) => {
  await signIn(page, ACCOUNTS.nour);
  await expect(page.getByText('This week’s plan is on its way.')).toBeVisible();
  await api(page, 'POST', '/api/auth/logout');
  await signIn(page, ACCOUNTS.lynn);
  await expect(page.getByRole('heading', { name: 'Nothing assigned yet' })).toBeVisible();
  await api(page, 'POST', '/api/auth/logout');
  await signIn(page, ACCOUNTS.karl);
  await expect(page.getByText('Your coaching plan is paused.')).toBeVisible();
});
