import { ACCOUNTS, api, expect, memberships, requireLive, signIn, test } from './support';

/**
 * The workout player against a live API: start, log a set as prescribed and one edited, swap a lift
 * and log under it (which keeps that lift, TRN-010), finish with sets left, read the summary and find
 * the workout in Training's history (TRN-019, TRN-029). Audit A4 adds the player's own fixes: effort
 * checked before the save and reps left logged (CLIENT-5, CLIENT-9), kg or lb chosen without an edit
 * (CLIENT-1), a set logged after another phone saved first (CLIENT-3), the question before leaving
 * typed work (WEA-1), and a finished workout's time that stays put (UIQ-1).
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
  actualRpe: number | null;
  isCompleted: boolean;
}
interface ExerciseView {
  performanceId: string | null;
  prescribedExerciseId: string;
  prescribedExerciseName: string;
  actualExerciseName: string;
  wasSubstituted: boolean;
  modificationPolicy: 'Locked' | 'CoachApprovedSwap';
  alternatives: { exerciseId: string; name: string }[];
  sets: SetView[];
}
interface WorkoutView {
  sessionId: string;
  name: string;
  status: string | null;
  workoutExecutionId: string | null;
  executionVersion: number | null;
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

  await test.step('A set logged under a swapped lift keeps that lift (CLIENT-2)', async () => {
    const current = await readWorkout(page, tenantId, workout.sessionId);
    const swapIndex = current.exercises.findIndex(
      (item, index) =>
        index !== exerciseIndex &&
        item.modificationPolicy === 'CoachApprovedSwap' &&
        item.alternatives.length > 0 &&
        item.sets.length > 0 &&
        !item.sets.some((set) => set.isCompleted),
    );
    if (swapIndex < 0) {
      test.info().annotations.push({
        type: 'note',
        description:
          'No lift of this workout can be swapped any more, so the swap step was not run.',
      });
      return;
    }
    const swappable = current.exercises[swapIndex];
    const alternative = swappable.alternatives[0];
    const picker = page.locator('.workout-exercise .swap-picker');

    await openPlayer();
    for (let i = 0; i < swapIndex; i++) {
      await page.getByRole('button', { name: /Next exercise/ }).click();
    }
    await expect(page.locator('.workout-exercise h2')).toHaveText(swappable.actualExerciseName);
    await picker.getByRole('button', { name: 'Swap exercise' }).click();
    await picker.getByRole('button', { name: alternative.name, exact: true }).click();
    await expect(notice).toHaveText(`Swapped to ${alternative.name}.`);
    await expect(page.locator('.workout-exercise h2')).toHaveText(alternative.name);

    // A swapped lift keeps the prescribed reps but not the load (TRN-029): the client types one.
    const card = setCard(0);
    await card.getByRole('spinbutton', { name: 'Actual load', exact: true }).fill('10');
    const reps = card.getByRole('spinbutton', { name: 'Actual repetitions', exact: true });
    if (!(await reps.inputValue())) await reps.fill('8');
    const kg = page.getByRole('radio', { name: 'kg' });
    const lb = page.getByRole('radio', { name: 'lb' });
    if (!(await kg.isChecked()) && !(await lb.isChecked())) await kg.click();
    await card.getByRole('button', { name: 'Log set' }).click();
    await expect(notice).toHaveText(/Set saved\.|New personal record!/);
    await page
      .getByRole('timer')
      .getByRole('button', { name: 'Skip' })
      .click()
      .catch(() => undefined);

    // The way back is listed but closed, saying why.
    await picker.getByRole('button', { name: 'Swap exercise' }).click();
    const back = picker.getByRole('button', { name: swappable.prescribedExerciseName });
    await expect(back).toHaveAttribute('aria-disabled', 'true');
    await expect(back).toContainText(`Not this workout: a set is logged as ${alternative.name}`);
    await page.keyboard.press('Escape');

    // The server refuses it too, for a second tab or an old page.
    const now = await readWorkout(page, tenantId, workout.sessionId);
    const refused = await api<{ code: string }>(
      page,
      'PUT',
      `/api/training/me/workouts/${now.workoutExecutionId}/exercises/${now.exercises[swapIndex].performanceId}/substitution`,
      {
        tenantId,
        body: { exerciseId: swappable.prescribedExerciseId, version: now.executionVersion },
      },
    );
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('substitution_after_logged_set');
    expect(now.exercises[swapIndex].actualExerciseName).toBe(alternative.name);

    // Back to the lift the rest of this test logs on.
    await openPlayer();
    await goToExercise();
  });

  await test.step('Effort is checked before the save, and reps left is logged as its RPE (CLIENT-5, CLIENT-9)', async () => {
    const third = openSets[2];
    if (!third) {
      test.info().annotations.push({
        type: 'note',
        description: 'This exercise had no third set to log, so the effort step was not run.',
      });
      return;
    }
    const card = setCard(exercise.sets.indexOf(third));
    const saves: string[] = [];
    const watchSaves = (request: { method(): string; url(): string }) => {
      if (request.method() === 'PUT' && request.url().includes('/sets/')) saves.push(request.url());
    };
    page.on('request', watchSaves);
    await card.getByText('More options').click();
    const rpe = card.getByRole('spinbutton', { name: 'Actual RPE' });
    await rpe.fill('8.3');
    // The range is said beside the field and the number marked, before anything is sent.
    await expect(rpe).toHaveAttribute('aria-invalid', 'true');
    await expect(card.locator('.hint-wrong')).toHaveText('5 to 10, in half steps');
    await card.getByRole('button', { name: 'Log set' }).click();
    await expect(card.locator('.player-error')).toHaveText(
      'RPE is a number from 5 to 10 in half steps, like 8 or 8.5.',
    );
    expect(saves).toEqual([]);

    await card.getByRole('spinbutton', { name: 'Actual reps left' }).fill('1.5');
    await expect(rpe).toHaveValue('');
    await card.getByRole('button', { name: 'Log set' }).click();
    await expect(notice).toHaveText(/Set saved\.|New personal record!/);
    page.off('request', watchSaves);
    expect(saves).toHaveLength(1);
    await page
      .getByRole('timer')
      .getByRole('button', { name: 'Skip' })
      .click()
      .catch(() => undefined);
    const saved = (await readWorkout(page, tenantId, workout.sessionId)).exercises[
      exerciseIndex
    ].sets.find((set) => set.position === third.position)!;
    expect(saved.isCompleted).toBe(true);
    expect(saved.actualRpe).toBe(8.5);
  });

  await test.step('Choosing lb then kg changes no set and blocks nothing (CLIENT-1)', async () => {
    // A fresh page first, so no typed draft of ours is pending: the choice alone is under test.
    const current = await readWorkout(page, tenantId, workout.sessionId);
    const loaded = current.exercises.findIndex(
      (item) =>
        !item.wasSubstituted &&
        item.sets.some(
          (set) =>
            !set.isCompleted &&
            set.prescribedLoad !== null &&
            set.prescribedLoadUnit === 'Kilogram',
        ),
    );
    await openPlayer();
    if (loaded >= 0) {
      for (let i = 0; i < loaded; i++) {
        await page.getByRole('button', { name: /Next exercise/ }).click();
      }
      const sets = current.exercises[loaded].sets;
      const open = sets.findIndex((set) => !set.isCompleted && set.prescribedLoad !== null);
      const input = setCard(open).getByRole('spinbutton', { name: 'Actual load', exact: true });
      await expect(input).toHaveValue(String(sets[open].prescribedLoad));
      await page.getByRole('radio', { name: 'lb' }).click();
      // Nothing is converted: the coach's kilograms wait for the client's own pounds, and it says so.
      await expect(input).toHaveValue('');
      await expect(page.locator('.unit-note')).toHaveText(
        'Your coach set these loads in kg. Type what you lift in lb.',
      );
      await expect(setCard(open).locator('.set-step label span').first()).toHaveText('Load (lb)');
      await page.getByRole('radio', { name: 'kg' }).click();
      await expect(input).toHaveValue(String(sets[open].prescribedLoad));
    } else {
      await page.getByRole('radio', { name: 'lb' }).click();
      await page.getByRole('radio', { name: 'kg' }).click();
    }
    await page.getByRole('button', { name: 'Finish workout' }).click();
    await expect(page.locator('.finish-confirmation')).toContainText('Finish workout?');
    await expect(page.locator('#training-error-summary')).not.toContainText(
      'Save every edited set',
    );
    await page.getByRole('button', { name: 'Keep training' }).click();
  });

  await test.step('Another phone logs first: the page reads the workout again and logs (CLIENT-3)', async () => {
    await openPlayer();
    const current = await readWorkout(page, tenantId, workout.sessionId);
    const open = current.exercises.flatMap((item, index) =>
      item.sets.filter((set) => !set.isCompleted).map((set) => ({ index, set })),
    );
    if (open.length < 2) {
      test.info().annotations.push({
        type: 'note',
        description: 'Fewer than two sets were left to log, so the two-phone step was not run.',
      });
      return;
    }
    const [elsewhere, here] = open;
    // The other phone logs its set (as prescribed, or 20 kg where the coach left the load open), so
    // the version this page read moves on.
    const other = await api(
      page,
      'PUT',
      `/api/training/me/workouts/${current.workoutExecutionId}/sets/${elsewhere.set.performanceId}`,
      {
        tenantId,
        body: {
          repetitions: elsewhere.set.prescribedRepetitionsMinimum ?? 5,
          load: elsewhere.set.prescribedLoad ?? 20,
          loadUnit: elsewhere.set.prescribedLoadUnit ?? 'Kilogram',
          rpe: null,
          rir: null,
          isCompleted: true,
          clientNote: null,
          version: current.executionVersion,
        },
      },
    );
    expect(other.status).toBe(200);

    for (let i = 0; i < here.index; i++) {
      await page.getByRole('button', { name: /Next exercise/ }).click();
    }
    const sets = current.exercises[here.index].sets;
    await setCard(sets.indexOf(here.set)).getByRole('button', { name: 'Log set' }).click();
    await expect(notice).toHaveText(/Set saved\.|New personal record!/);
    await expect(page.locator('#training-error-summary')).toHaveText('');
    if (elsewhere.index === here.index) {
      await expect(setCard(sets.indexOf(elsewhere.set)).locator('.logged-set')).toBeVisible();
    }
    await page
      .getByRole('timer')
      .getByRole('button', { name: 'Skip' })
      .click()
      .catch(() => undefined);
    const after = await readWorkout(page, tenantId, workout.sessionId);
    const logged = after.exercises[here.index].sets.find(
      (set) => set.performanceId === here.set.performanceId,
    )!;
    expect(logged.isCompleted).toBe(true);
  });

  await test.step('Leaving with a typed load asks first, and Stay keeps it (WEA-1)', async () => {
    await openPlayer();
    const current = await readWorkout(page, tenantId, workout.sessionId);
    const index = current.exercises.findIndex((item) => item.sets.some((set) => !set.isCompleted));
    if (index < 0) {
      test.info().annotations.push({
        type: 'note',
        description: 'No set was left to type into, so the leaving step was not run.',
      });
      return;
    }
    for (let i = 0; i < index; i++) {
      await page.getByRole('button', { name: /Next exercise/ }).click();
    }
    const setIndex = current.exercises[index].sets.findIndex((set) => !set.isCompleted);
    const input = setCard(setIndex).getByRole('spinbutton', { name: 'Actual load', exact: true });
    await input.fill('77.5');
    await page.getByRole('link', { name: 'Back to Today' }).click();
    const ask = page.getByRole('dialog', { name: 'Leave without saving?' });
    await expect(ask).toContainText('Sets you changed aren’t logged.');
    await ask.getByRole('button', { name: 'Stay' }).click();
    await expect(ask).toHaveCount(0);
    expect(new URL(page.url()).pathname).toBe('/training/today');
    await expect(input).toHaveValue('77.5');

    await page.getByRole('link', { name: 'Back to Today' }).click();
    await ask.getByRole('button', { name: 'Leave without saving' }).click();
    await page.waitForURL((url) => url.pathname === '/');
    // Leaving logged nothing.
    const after = await readWorkout(page, tenantId, workout.sessionId);
    expect(after.exercises[index].sets[setIndex].isCompleted).toBe(false);
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
    if (volume > 0) {
      // In Training's words: "862.5 kg lifted", never "kg × reps" (CLIENT-5).
      await expect(summary.locator('.summary-stats')).toContainText(
        volume.toLocaleString('en-US', { maximumFractionDigits: 1 }),
      );
      await expect(summary.locator('.summary-stats')).toContainText('lifted');
      await expect(summary).not.toContainText('× reps');
    }
    expect((await readWorkout(page, tenantId, workout.sessionId)).status).toBe('Completed');
    summaryRecords = await summary.locator('.pr-list li').allInnerTexts();

    // The header shows the summary's time and stops counting (UIQ-1).
    const time = (await summary.locator('.summary-stats strong').first().innerText()).trim();
    const clock = page.locator('.clock');
    await expect(clock).toContainText(`Workout took ${time}`);
    await page.waitForTimeout(2_500);
    await expect(clock).toContainText(`Workout took ${time}`);
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
  // The time it took, which no longer counts on from its start hours later (UIQ-1).
  const clock = page.locator('.clock');
  await expect(clock).toHaveText(/^\s*Workout took \d+:\d{2}\s*$/);
  const took = await clock.textContent();
  await page.waitForTimeout(2_500);
  await expect(clock).toHaveText(took!);
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
