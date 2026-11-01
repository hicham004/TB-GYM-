import type { Browser, Page } from '@playwright/test';
import {
  ACCOUNTS,
  acceptLegalDocuments,
  api,
  expect,
  memberships,
  requireLive,
  signIn,
  test,
  uniqueEmail,
} from './support';

/**
 * Finished programs, live (critique B19, TRN-031), against PostgreSQL and the real antiforgery. Karim
 * gives a client created here a program of one workout, today, and the client finishes it. Unticking
 * "Can see finished programs" takes it off their Training page on the server, share card included,
 * while their logged workout and record stay and the coach's screen does not change; ticking it again
 * brings it back. A running program does not move.
 */
requireLive();

interface Exercises {
  items: { id: string; name: string }[];
}
interface Draft {
  id: string;
  version: number;
}
interface ClientRead {
  isAllowed: boolean;
  accessReason: string;
  program: { id: string; phase: string } | null;
}
interface Day {
  workouts: {
    sessionId: string;
    status: string | null;
    exercises: { sets: { performanceId: string | null }[] }[];
  }[];
}

/** A published program of one week holding `sessions` workouts, all on its first day. */
async function publishProgram(
  coach: Page,
  tenantId: string,
  name: string,
  sessions: number,
): Promise<string> {
  const library = await api<Exercises>(coach, 'GET', '/api/exercises?take=100', { tenantId });
  const exercise = library.body.items.find((item) => item.name === 'Overhead Press');
  expect(exercise).toBeDefined();
  const draft = await api<Draft>(coach, 'POST', '/api/training/program-drafts', {
    tenantId,
    body: {
      templateId: null,
      sourceVersionId: null,
      content: {
        name,
        description: null,
        weeks: [
          {
            label: 'Week 1',
            isPublished: true,
            sessions: Array.from({ length: sessions }, (_, index) => ({
              name: `Workout ${index + 1}`,
              dayOffset: 0,
              coachNotes: null,
              exercises: [
                {
                  exerciseId: exercise!.id,
                  position: 1,
                  isMainLift: true,
                  modificationPolicy: 'Locked',
                  coachNotes: null,
                  approvedAlternativeExerciseIds: [],
                  sets: [
                    {
                      position: 1,
                      setType: 'Normal',
                      repetitionsMinimum: 5,
                      repetitionsMaximum: 5,
                      loadStrategy: 'Direct',
                      directLoad: 40,
                      loadUnit: 'Kilogram',
                      percentageWorkingMax: null,
                      targetRpe: 8,
                      targetRir: null,
                      exertionDisplayPreference: 'Rpe',
                      restSeconds: 180,
                      tempo: null,
                      coachNotes: null,
                      manualLoadOverride: null,
                    },
                  ],
                },
              ],
            })),
          },
        ],
      },
    },
  });
  expect(draft.status).toBeLessThan(300);
  const published = await api<{ id: string }>(
    coach,
    'POST',
    `/api/training/program-drafts/${draft.body.id}/publish`,
    { tenantId, body: { version: draft.body.version, replaceNewer: false } },
  );
  expect(published.status).toBeLessThan(300);
  return published.body.id;
}

/** A client of Karim's on a free plan from today, created through the real invitation, on a phone. */
async function newClient(browser: Browser, coach: Page, tenantId: string, firstName: string) {
  const invited = await api<{ developmentActionUrl: string }>(coach, 'POST', '/api/invitations', {
    tenantId,
    body: {
      email: uniqueEmail('finished.programs'),
      firstName,
      lastName: `Spec${Date.now().toString(36)}`,
      phoneNumber: null,
      birthDate: '1991-02-03',
      idempotencyKey: crypto.randomUUID(),
    },
  });
  expect(invited.status).toBe(201);
  const phone = await browser.newContext({
    baseURL: new URL(invited.body.developmentActionUrl).origin,
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    timezoneId: 'Asia/Beirut',
    locale: 'en-US',
  });
  const client = await phone.newPage();
  await client.goto(invited.body.developmentActionUrl);
  await client.getByLabel('Display name').fill(`${firstName} Spec`);
  await client.getByLabel('Password', { exact: true }).fill('Finished-Programs-2026!');
  await client.getByLabel('Confirm password').fill('Finished-Programs-2026!');
  await acceptLegalDocuments(client);
  await client.getByRole('button', { name: 'Create account and join' }).click();
  await expect(client).toHaveURL(/\/profile/, { timeout: 30_000 });
  const id = (await api<{ id: string }>(client, 'GET', '/api/client-profile/me', { tenantId })).body
    .id;
  return { client, id, close: () => phone.close() };
}

/** Sells the client a free plan of four weeks from today and assigns the program on it. */
async function assignFromToday(
  coach: Page,
  tenantId: string,
  clientId: string,
  templateVersionId: string,
): Promise<void> {
  const workspace = await api<{ currentDate: string }>(coach, 'GET', '/api/workspace', {
    tenantId,
  });
  const startDate = workspace.body.currentDate;
  const product = await api<{ offers: { id: string }[] }>(
    coach,
    'POST',
    '/api/commercial/products',
    {
      tenantId,
      body: {
        name: `Finished ${Date.now().toString(36)}`,
        initialOffer: {
          label: '4 weeks',
          durationCount: 4,
          durationUnit: 'Week',
          priceAmount: 0,
          priceCurrency: 'USD',
          features: [{ feature: 'Training', allowsConcurrentCoverage: false }],
        },
      },
    },
  );
  expect(product.status).toBe(200);
  const sold = await api<{ id: string }>(
    coach,
    'POST',
    `/api/commercial/clients/${clientId}/enrollments`,
    {
      tenantId,
      body: {
        offerId: product.body.offers[0].id,
        startDate,
        idempotencyKey: crypto.randomUUID(),
      },
    },
  );
  expect(sold.status).toBe(200);
  const assigned = await api(coach, 'POST', `/api/training/clients/${clientId}/mesocycles`, {
    tenantId,
    body: {
      enrollmentId: sold.body.id,
      templateVersionId,
      startDate,
      kind: 'Primary',
      loadUnit: 'Kilogram',
      loadIncrement: 2.5,
      loadRoundingMode: 'Nearest',
      workingMaxes: [],
      idempotencyKey: crypto.randomUUID(),
      name: null,
    },
  });
  expect(assigned.status).toBeLessThan(300);
}

/** The client does today's first open workout from start to finish. */
async function finishAWorkout(client: Page, tenantId: string, load: number): Promise<void> {
  const before = await api<Day>(client, 'GET', '/api/training/me/today', { tenantId });
  const sessionId = before.body.workouts.find((workout) => workout.status === null)!.sessionId;
  const started = await api<{ id: string; version: number }>(
    client,
    'POST',
    `/api/training/me/sessions/${sessionId}/start`,
    { tenantId },
  );
  expect(started.status).toBe(200);
  const day = await api<Day>(client, 'GET', '/api/training/me/today', { tenantId });
  const workout = day.body.workouts.find((item) => item.sessionId === sessionId)!;
  const saved = await api<{ executionVersion: number }>(
    client,
    'PUT',
    `/api/training/me/workouts/${started.body.id}/sets/${workout.exercises[0].sets[0].performanceId}`,
    {
      tenantId,
      body: {
        repetitions: 5,
        load,
        loadUnit: 'Kilogram',
        rpe: 8,
        isCompleted: true,
        clientNote: null,
        version: started.body.version,
      },
    },
  );
  expect(saved.status).toBe(200);
  const done = await api(client, 'POST', `/api/training/me/workouts/${started.body.id}/complete`, {
    tenantId,
    body: { version: saved.body.executionVersion },
  });
  expect(done.status).toBe(200);
}

const read = async (client: Page, tenantId: string) =>
  (await api<ClientRead>(client, 'GET', '/api/training/me/program', { tenantId })).body;

/** Ticks or unticks the box on the coach's page and waits for the page's own word that it is saved. */
async function choose(page: Page, clientId: string, canSee: boolean, says: string): Promise<void> {
  await page.goto(`/clients/${clientId}/training`);
  const box = page.getByRole('checkbox', { name: 'Can see finished programs' });
  await expect(box).toBeChecked({ checked: !canSee, timeout: 20_000 });
  await box.click();
  await expect(page.getByRole('status').filter({ hasText: says })).toBeVisible({ timeout: 20_000 });
  await expect(box).toBeChecked({ checked: canSee });
}

test('a finished program leaves the client’s Training page when the coach unticks it, and comes back', async ({
  browser,
  page,
}) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, ACCOUNTS.owner);
  const [{ tenantId }] = await memberships(page);
  const stamp = Date.now().toString(36);
  const program = `Finished ${stamp}`;
  const template = await publishProgram(page, tenantId, program, 1);
  const { client, id, close } = await newClient(browser, page, tenantId, 'Rana');
  await assignFromToday(page, tenantId, id, template);
  await finishAWorkout(client, tenantId, 42.5);

  // On, by default: the Training page keeps the program, with its share card.
  await client.goto('/training/program');
  await expect(client.locator('.hero-eyebrow')).toHaveText('Program finished', { timeout: 20_000 });
  await expect(client.getByRole('button', { name: 'Share your program' })).toBeVisible();
  const finished = (await read(client, tenantId)).program!;
  expect(finished.phase).toBe('Finished');
  const summaryUrl = `/api/training/me/programs/${finished.id}/summary`;
  expect((await api(client, 'GET', summaryUrl, { tenantId })).status).toBe(200);

  // Off: the server sends nothing of it, and the page is the one with nothing assigned.
  await choose(page, id, false, 'Rana no longer sees finished programs.');
  await client.reload();
  await expect(client.getByRole('heading', { name: 'Nothing assigned yet' })).toBeVisible({
    timeout: 20_000,
  });
  await expect(client.locator('.hero')).toHaveCount(0);
  await expect(client.getByRole('button', { name: 'Share your program' })).toHaveCount(0);
  expect(await read(client, tenantId)).toMatchObject({ isAllowed: true, program: null });
  expect((await api(client, 'GET', summaryUrl, { tenantId })).status).toBe(404);

  // The client's own workout and record stay, under the page's own words.
  await expect(client.getByRole('heading', { name: 'Finished workouts' })).toBeVisible();
  const logged = client.locator('.history-item');
  await expect(logged).toHaveCount(1);
  await expect(logged).toContainText('Workout 1');
  await expect(logged).toContainText('1 of 1 sets');
  await expect(logged.locator('.pr-badge')).toBeVisible();
  const history = await api<{ items: { workoutExecutionId: string }[] }>(
    client,
    'GET',
    '/api/training/me/history',
    { tenantId },
  );
  expect(history.body.items).toHaveLength(1);

  // The coach's screen has not changed: the program is still in front of them.
  await page.reload();
  await expect(page.getByRole('heading', { name: program })).toBeVisible({ timeout: 20_000 });

  // Ticked again it comes back, from the same page.
  await choose(page, id, true, 'Rana can see finished programs.');
  await client.reload();
  await expect(client.locator('.hero-eyebrow')).toHaveText('Program finished', { timeout: 20_000 });
  expect((await api(client, 'GET', summaryUrl, { tenantId })).status).toBe(200);
  await close();
});

test('unticking it leaves a running program where it is', async ({ browser, page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, ACCOUNTS.owner);
  const [{ tenantId }] = await memberships(page);
  const template = await publishProgram(page, tenantId, `Running ${Date.now().toString(36)}`, 2);
  const { client, id, close } = await newClient(browser, page, tenantId, 'Maha');
  await assignFromToday(page, tenantId, id, template);
  await finishAWorkout(client, tenantId, 40);

  await choose(page, id, false, 'Maha no longer sees finished programs.');
  await client.goto('/training/program');
  await expect(client.locator('.hero-eyebrow')).toContainText('Week 1', { timeout: 20_000 });
  expect((await read(client, tenantId)).program?.phase).toBe('Current');
  await close();
});
