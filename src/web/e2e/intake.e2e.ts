import AxeBuilder from '@axe-core/playwright';
import type { Page, Route } from '@playwright/test';
import type { CoachClientDetails, ClientSelfProfile } from '../src/app/core/api/api.models';
import {
  COACH_USER_ID,
  coachView,
  finishedProfile,
  halfwayProfile,
  newProfile,
  NOW,
  workspace,
} from '../src/testing/intake-fixtures';
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
 * My profile and the client's intake (R5.3b) in a real browser: a new client's five steps, a
 * finished profile as cards with an Edit sheet on each, the leave warning, and the coach's view of the
 * same answers. Every API call is a per-test mock answered in place, so a save shows on the next read.
 */
const ATLAS_CLIENT = {
  tenantId: '00000000-0000-4000-8000-000000000003',
  tenantName: 'Atlas Performance',
  tenantSlug: 'atlas-performance',
  role: 'Client',
};
const RANA = {
  ...SIGNED_IN_USER,
  id: '00000000-0000-4000-8000-0000000000cc',
  email: 'rana@example.test',
  displayName: 'Rana Haddad',
  preferredWeightUnit: 'Kilogram',
};
const FEATURES = ['Training', 'Nutrition', 'CheckIns', 'Messaging', 'ResourceLibrary'];
const FIELD_WARNING = 'Check the fields marked above.';

type Handler = (route: Route) => Promise<void> | void;
interface Writes {
  saved: Record<string, unknown>[];
  completed: Record<string, unknown>[];
}

const HEALTH = ['allergies', 'medications', 'previousInjuries'] as const;

/** The server's refusal of a health answer while the Health step is closed (N9c5a): `{ code, message }`. */
const HEALTH_CLOSED = {
  code: 'health_step_closed',
  message: "Health answers open on Max, TB Gym's coaching. Your other answers can still be saved.",
};

/**
 * Whether the server would refuse an intake while the Health step is closed (CLI-028): a health answer
 * that is there and differs from the one held. One kept as it is passes.
 */
function refusesHealth(profile: ClientSelfProfile, body: Record<string, unknown>): boolean {
  if (profile.healthStepOpen !== false) return false;
  return HEALTH.some((field) => {
    const sent = typeof body[field] === 'string' ? (body[field] as string).trim() : null;
    return sent !== null && sent !== '' && sent !== profile[field];
  });
}

/** What the server would hold after an intake request: the answers it carries, one version on. */
function applyIntake<T extends ClientSelfProfile>(profile: T, body: Record<string, unknown>): T {
  const heightValue = body['heightValue'] as number | null;
  const heightUnit = body['heightUnit'] as 'Centimeter' | 'Inch' | null;
  return {
    ...profile,
    firstName: body['firstName'] as string,
    lastName: body['lastName'] as string,
    phoneNumber: body['phoneNumber'] as string | null,
    birthDate: body['birthDate'] as string | null,
    heightEnteredValue: heightValue,
    heightEnteredUnit: heightUnit,
    heightCentimeters:
      heightValue === null ? null : heightUnit === 'Inch' ? heightValue * 2.54 : heightValue,
    workType: body['workType'] as string | null,
    averageDailySteps: body['averageDailySteps'] as number | null,
    trainingBackground: body['trainingBackground'] as string | null,
    foodPreferences: body['foodPreferences'] as string | null,
    foodAversions: body['foodAversions'] as string | null,
    goals: body['goals'] as string | null,
    allergies: body['allergies'] as string | null,
    medications: body['medications'] as string | null,
    previousInjuries: body['previousInjuries'] as string | null,
    onboardingStatus: profile.onboardingStatus === 'Completed' ? 'Completed' : 'InProgress',
    version: profile.version + 1,
  };
}

async function openMyProfile(
  page: Page,
  width: number,
  options: {
    profile?: ClientSelfProfile;
    dark?: boolean;
    height?: number;
    refuseSaves?: boolean;
    /** Max ends just before the first save lands, so the Health step closes under the person (N9c5a). */
    maxEndsOnSave?: boolean;
    extra?: Record<string, Handler>;
  } = {},
) {
  await page.clock.setFixedTime(new Date(NOW));
  await page.emulateMedia({ colorScheme: options.dark ? 'dark' : 'light' });
  await page.setViewportSize({ width, height: options.height ?? 900 });
  let profile = options.profile ?? newProfile();
  let maxEnds = options.maxEndsOnSave === true;
  const writes: Writes = { saved: [], completed: [] };
  await mockSession(page, {
    memberships: [ATLAS_CLIENT],
    user: RANA,
    extra: {
      'GET /api/client-access/me': (route) =>
        json(
          route,
          200,
          FEATURES.map((feature) => ({ feature, isAllowed: true, reason: 'Granted' })),
        ),
      'GET /api/client-profile/me/coach': (route) => json(route, 200, { name: 'Lea Haddad' }),
      'GET /api/client-profile/me': (route) => json(route, 200, profile),
      'GET /api/workspace': (route) => json(route, 200, workspace()),
      'PUT /api/client-profile/me/intake': (route) => {
        const body = route.request().postDataJSON() as Record<string, unknown>;
        writes.saved.push(body);
        if (options.refuseSaves) {
          return json(route, 409, {
            title: 'Your profile was changed elsewhere. Reload it and try again.',
          });
        }
        if (maxEnds) {
          maxEnds = false;
          profile = { ...profile, healthStepOpen: false };
        }
        if (refusesHealth(profile, body)) return json(route, 409, HEALTH_CLOSED);
        profile = applyIntake(profile, body);
        return json(route, 200, profile);
      },
      'POST /api/client-profile/me/complete-onboarding': (route) => {
        const body = route.request().postDataJSON() as { intake: Record<string, unknown> };
        writes.completed.push(body);
        if (refusesHealth(profile, body.intake)) return json(route, 409, HEALTH_CLOSED);
        profile = { ...applyIntake(profile, body.intake), onboardingStatus: 'Completed' };
        return json(route, 200, profile);
      },
      ...(options.extra ?? {}),
    },
  });
  await page.goto('/profile');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
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

async function typeBirthDate(page: Page, day: string, month: string, year: string) {
  await page.getByLabel('Day').fill(day);
  await page.getByLabel('Month').fill(month);
  await page.getByLabel('Year').fill(year);
}

const stepHeading = (page: Page, name: string) =>
  expect(page.locator('#intake-step-heading')).toHaveText(name);

test('a new client answers five short steps, each saved as they go, and is told they are set', async ({
  page,
}) => {
  const writes = await openMyProfile(page, 390);

  await expect(page.getByRole('heading', { level: 1, name: 'Set up your profile' })).toBeVisible();
  await expect(page.locator('.kicker')).toHaveText('Step 1 of 5');
  await stepHeading(page, 'About you');
  await expect(page.getByLabel('First name')).toHaveValue('Rana');
  await expectNoHorizontalOverflow(page);
  await axe(page);
  await page.screenshot({ path: 'test-results/r53b-step-about-390.png', fullPage: true });

  await page.getByLabel('Phone number (optional)').fill('+96170123456');
  await typeBirthDate(page, '2', '4', '1996');
  await page.getByLabel('Height', { exact: true }).fill('168');
  await page.getByRole('button', { name: 'Continue' }).click();
  await stepHeading(page, 'Your goal');
  await expect(page.locator('.kicker')).toHaveText('Step 2 of 5');
  await expect(page.locator('#intake-step-heading')).toBeFocused();
  await page.getByLabel('Goals').fill('Run a 10k in under an hour by June.');
  await axe(page);
  await page.getByRole('button', { name: 'Continue' }).click();

  await stepHeading(page, 'Your day and food');
  await page.getByLabel('Work (optional)').fill('Desk job');
  await page.getByLabel('Average daily steps (optional)').fill('6500');
  await page.getByRole('button', { name: 'Continue' }).click();

  await stepHeading(page, 'Your health');
  // Only the client's coach reads them, the owner included (N9d1a).
  await expect(page.locator('.privacy')).toHaveText(
    'Only you and your coach can see these answers.',
  );
  await expectNoHorizontalOverflow(page);
  await axe(page);
  await page.screenshot({ path: 'test-results/r53b-step-health-390.png', fullPage: true });
  await page.getByRole('button', { name: 'Continue' }).click();

  await stepHeading(page, 'Where you start');
  await expect(page.locator('.kicker')).toHaveText('Step 5 of 5');
  await expect(page.getByRole('button', { name: 'Finish setting up' })).toBeVisible();
  await page.getByLabel('Weight', { exact: true }).fill('62.5');
  await expectNoHorizontalOverflow(page);
  await axe(page);
  await page.screenshot({ path: 'test-results/r53b-step-start-390.png', fullPage: true });
  await page.getByRole('button', { name: 'Finish setting up' }).click();

  await expect(page.getByRole('heading', { name: 'You’re all set, Rana' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Go to Today' })).toBeVisible();
  await axe(page);
  await page.screenshot({ path: 'test-results/r53b-done-390.png', fullPage: true });

  expect(writes.saved.map((body) => body['version'])).toEqual([4, 5, 6, 7]);
  expect(writes.saved[0]).toMatchObject({ birthDate: '1996-04-02', heightValue: 168, goals: null });
  expect(writes.saved[1]).toMatchObject({ goals: 'Run a 10k in under an hour by June.' });
  expect(writes.completed).toEqual([
    expect.objectContaining({
      initialBodyweightValue: 62.5,
      initialBodyweightUnit: 'Kilogram',
      measurementDate: '2026-10-10',
      intake: expect.objectContaining({
        version: 8,
        workType: 'Desk job',
        averageDailySteps: 6500,
      }),
    }),
  ]);

  await page.getByRole('button', { name: 'See my answers' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'My profile' })).toBeVisible();
  await expect(page.locator('.panel-head h2')).toHaveText([
    'About you',
    'Your goal',
    'Your day and food',
    'Your health',
  ]);
});

test('a step with something missing says what, in words, and puts focus on the first thing', async ({
  page,
}) => {
  const writes = await openMyProfile(page, 390);

  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(page.getByText('Enter a date of birth: day, month and year.')).toBeVisible();
  await expect(page.getByText('Enter a height.')).toBeVisible();
  await expect(page.getByRole('alert')).toHaveText(FIELD_WARNING);
  await expect(page.getByLabel('Day')).toBeFocused();
  await expectNoHorizontalOverflow(page);
  await axe(page);
  await page.screenshot({ path: 'test-results/r53b-step-errors-390.png', fullPage: true });
  expect(writes.saved).toEqual([]);

  await typeBirthDate(page, '30', '2', '1996');
  await page.getByLabel('Height', { exact: true }).fill('168');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(
    page.getByText('That day does not exist. Check the day and the month.'),
  ).toBeVisible();
});

test('a client who stopped half way starts at the first step not done, with the others marked done', async ({
  page,
}) => {
  await openMyProfile(page, 390, { profile: halfwayProfile() });

  await expect(page.locator('.kicker')).toHaveText('Step 3 of 5');
  await stepHeading(page, 'Your day and food');
  await expect(page.locator('.progress .item.done')).toHaveCount(2);
  await expect(page.locator('.progress .item.current .name')).toHaveText('Day and food');
  await axe(page);
  await page.screenshot({ path: 'test-results/r53b-step-resume-390.png', fullPage: true });

  await page.getByRole('button', { name: 'Back' }).click();
  await stepHeading(page, 'Your goal');
  await expect(page.getByLabel('Goals')).toHaveValue('Run a 10k in under an hour by June.');
});

test.describe('when the server refuses a step', () => {
  // The browser logs the failed request itself; what matters is that the step says why.
  test.use({ allowedConsoleErrors: { patterns: [/status of 409 .*\/api\/client-profile/] } });

  test('the reason stays on the step, in view above the buttons, with everything typed kept', async ({
    page,
  }) => {
    await openMyProfile(page, 390, { height: 600, refuseSaves: true });

    await typeBirthDate(page, '2', '4', '1996');
    await page.getByLabel('Height', { exact: true }).fill('168');
    await page.getByRole('button', { name: 'Continue' }).click();

    const refusal = page.locator('app-form-summary');
    await expect(refusal).toHaveText(
      'Your profile was changed elsewhere. Reload it and try again.',
    );
    // The phone's tab bar is pinned over the foot of the page: the reason and the button that sent
    // it are both brought up above it, not left behind it.
    await expect(async () => {
      const reason = (await refusal.boundingBox())!;
      const next = (await page.getByRole('button', { name: 'Continue' }).boundingBox())!;
      const tabs = (await page.locator('app-client-tabs').boundingBox())!;
      expect(reason.y).toBeGreaterThanOrEqual(0);
      expect(reason.y + reason.height).toBeLessThanOrEqual(tabs.y);
      expect(next.y + next.height).toBeLessThanOrEqual(tabs.y);
    }).toPass();
    await stepHeading(page, 'About you');
    await expect(page.getByLabel('Height', { exact: true })).toHaveValue('168');
    await axe(page);
    await page.screenshot({ path: 'test-results/r53b-step-refused-390.png' });
  });
});

test('a half typed step asks before the person leaves, and stays when they say stay', async ({
  page,
}) => {
  await openMyProfile(page, 390);

  await page.getByLabel('Phone number (optional)').fill('+9617');
  await page.getByRole('link', { name: 'Me', exact: true }).first().click();
  const ask = page.getByRole('dialog');
  await expect(ask).toContainText('The answers on this step aren’t saved.');
  await axe(page);
  await page.screenshot({ path: 'test-results/r53b-leave-390.png' });
  await ask.getByRole('button', { name: 'Stay' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByLabel('Phone number (optional)')).toHaveValue('+9617');
  await expect(page).toHaveURL(/\/profile$/);

  await page.getByRole('link', { name: 'Me', exact: true }).first().click();
  await page.getByRole('dialog').getByRole('button', { name: 'Leave without saving' }).click();
  await expect(page).toHaveURL(/\/me$/);
});

for (const width of [390, 1440]) {
  test(`a finished profile is cards of answers at ${width}px, light and dark, and passes axe`, async ({
    page,
  }) => {
    await openMyProfile(page, width, { profile: finishedProfile() });

    await expect(page.getByRole('heading', { level: 1, name: 'My profile' })).toBeVisible();
    await expect(page.locator('.panel-head h2')).toHaveText([
      'About you',
      'Your goal',
      'Your day and food',
      'Your health',
    ]);
    await expect(page.getByText('2 Apr 1996')).toBeVisible();
    await expect(page.locator('.answer', { hasText: 'Medications' })).toContainText('Not added');
    await expectNoHorizontalOverflow(page);
    await axe(page);
    await page.screenshot({ path: `test-results/r53b-profile-${width}.png`, fullPage: true });

    await page.emulateMedia({ colorScheme: 'dark' });
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'My profile' })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await axe(page);
    await page.screenshot({ path: `test-results/r53b-profile-dark-${width}.png`, fullPage: true });
  });
}

test('a client changes one group in a sheet, and the card shows what was saved', async ({
  page,
}) => {
  const writes = await openMyProfile(page, 390, { profile: finishedProfile() });

  await page.getByRole('button', { name: 'Edit Your day and food' }).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByRole('heading', { name: 'Your day and food' })).toBeVisible();
  await sheet.getByLabel('Work (optional)').fill('Nurse, night shifts');
  await sheet.getByLabel('Average daily steps (optional)').fill('9000');
  await expectNoHorizontalOverflow(page);
  await axe(page);
  await page.screenshot({ path: 'test-results/r53b-edit-sheet-390.png' });
  await sheet.getByRole('button', { name: 'Save changes' }).click();

  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('Your details were saved.')).toBeVisible();
  await expect(page.locator('.answer', { hasText: 'Work' }).first()).toContainText(
    'Nurse, night shifts',
  );
  await expect(page.locator('.answer', { hasText: 'Average daily steps' })).toContainText('9,000');
  expect(writes.saved).toEqual([
    expect.objectContaining({
      workType: 'Nurse, night shifts',
      averageDailySteps: 9000,
      goals: 'Run a 10k in under an hour by June.',
      version: 9,
    }),
  ]);
});

test('a sheet with typing in it asks before Not now closes it', async ({ page }) => {
  await openMyProfile(page, 390, { profile: finishedProfile() });

  await page.getByRole('button', { name: 'Edit Your health' }).click();
  const sheet = page.getByRole('dialog');
  await sheet.getByLabel('Allergies (optional)').fill('Shellfish');
  await sheet.getByRole('button', { name: 'Not now' }).click();
  await expect(
    page.getByRole('dialog').getByRole('heading', { name: 'Discard what you typed?' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Keep editing' }).click();
  await expect(sheet.getByLabel('Allergies (optional)')).toHaveValue('Shellfish');
});

test('right to left: the steps keep their order and nothing overflows', async ({ page }) => {
  await openMyProfile(page, 390, { profile: halfwayProfile() });
  await useRtl(page);

  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: 'test-results/r53b-step-rtl-390.png', fullPage: true });
});

// ---------- a trainee of TB Gym's own space: the Health step follows Max (N9c5a) ----------

/** A Free trainee: TB Gym's own space, off Max, so the Health step is closed. */
const OFF_MAX = { selfDirected: true, coachedByTheHouse: false, healthStepOpen: false } as const;
/** A Max trainee: TB Gym coaches them, so the Health step is open. */
const ON_MAX = { selfDirected: true, coachedByTheHouse: true, healthStepOpen: true } as const;
const CLOSED_NOTE = 'Health answers open on Max, TB Gym’s coaching, so these can’t be changed now.';
const CLOSED_REFUSAL =
  'Health answers open on Max, TB Gym’s coaching. Your other answers can still be saved.';

/** The progress list's last bar ends where the list does: no column is left empty. */
async function expectProgressFilled(page: Page) {
  const list = (await page.locator('.progress').boundingBox())!;
  const last = (await page.locator('.progress .item').last().boundingBox())!;
  expect(Math.abs(last.x + last.width - (list.x + list.width))).toBeLessThan(1);
}

test('a Free trainee answers four steps, without Health, and every save sends the held health answers back as they are', async ({
  page,
}) => {
  // An answer given while on Max earlier stays as it is: never emptied, never changed.
  const writes = await openMyProfile(page, 390, {
    profile: newProfile({ ...OFF_MAX, medications: 'Ventolin' }),
  });

  await expect(page.locator('.kicker')).toHaveText('Step 1 of 4');
  await expect(page).toHaveTitle(/^About you \(step 1 of 4\)/);
  await expect(page.locator('.progress .item')).toHaveCount(4);
  await expectProgressFilled(page);
  await expectNoHorizontalOverflow(page);
  await axe(page);
  await page.screenshot({ path: 'test-results/n9c5b-free-step-about-390.png', fullPage: true });

  await typeBirthDate(page, '2', '4', '1996');
  await page.getByLabel('Height', { exact: true }).fill('168');
  await page.getByRole('button', { name: 'Continue' }).click();
  await stepHeading(page, 'Your goal');
  await expect(page.locator('.kicker')).toHaveText('Step 2 of 4');
  await page.getByLabel('Goals').fill('Squat my bodyweight.');
  await page.getByRole('button', { name: 'Continue' }).click();
  await stepHeading(page, 'Your day and food');
  await expect(page.locator('.kicker')).toHaveText('Step 3 of 4');
  await page.getByRole('button', { name: 'Continue' }).click();

  await stepHeading(page, 'Where you start');
  await expect(page.locator('.kicker')).toHaveText('Step 4 of 4');
  await expect(page.locator('.privacy')).toHaveCount(0);
  await page.getByLabel('Weight', { exact: true }).fill('62.5');
  await axe(page);
  await page.getByRole('button', { name: 'Finish setting up' }).click();
  await expect(page.getByRole('heading', { name: 'You’re all set, Rana' })).toBeVisible();

  const held = { allergies: null, medications: 'Ventolin', previousInjuries: null };
  expect(writes.saved).toHaveLength(3);
  for (const body of writes.saved) expect(body).toMatchObject(held);
  expect(writes.completed).toEqual([
    expect.objectContaining({ intake: expect.objectContaining(held) }),
  ]);

  // The answer held is still read, on its own card, with no Edit.
  await page.getByRole('button', { name: 'See my answers' }).click();
  await expect(page.locator('.panel-head h2')).toHaveText([
    'About you',
    'Your goal',
    'Your day and food',
    'Your health',
  ]);
  await expect(page.locator('[data-health-closed]')).toHaveText(CLOSED_NOTE);
  await expect(page.getByRole('button', { name: 'Edit Your health' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Edit/ })).toHaveCount(3);
});

test('a Free trainee’s four steps follow dark mode, reflow at 200% text and read right to left', async ({
  page,
}) => {
  await openMyProfile(page, 390, { profile: halfwayProfile(OFF_MAX), dark: true });

  await expect(page.locator('.kicker')).toHaveText('Step 3 of 4');
  await expect(page.locator('.progress .item.done')).toHaveCount(2);
  await expectProgressFilled(page);
  await axe(page);
  await page.screenshot({ path: 'test-results/n9c5b-free-step-dark-390.png', fullPage: true });

  await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: 'test-results/n9c5b-free-step-200-390.png', fullPage: true });

  await useRtl(page);
  await expectNoHorizontalOverflow(page);
});

test('a Max trainee has all five steps, Health among them, and gives health answers there', async ({
  page,
}) => {
  const writes = await openMyProfile(page, 390, {
    profile: halfwayProfile({ ...ON_MAX, workType: 'Teacher' }),
  });

  await expect(page.locator('.progress .name')).toHaveText([
    'About you, done',
    'Goal, done',
    'Day and food, done',
    'Health',
    'Weight',
  ]);
  await expectProgressFilled(page);
  await stepHeading(page, 'Your health');
  await expect(page.locator('.kicker')).toHaveText('Step 4 of 5');
  await expect(page.locator('.privacy')).toHaveText(
    'Only you and your coach can see these answers.',
  );
  await page.getByLabel('Allergies (optional)').fill('Shellfish');
  await axe(page);
  await page.getByRole('button', { name: 'Continue' }).click();

  await stepHeading(page, 'Where you start');
  await expect(page.locator('.kicker')).toHaveText('Step 5 of 5');
  expect(writes.saved).toEqual([expect.objectContaining({ allergies: 'Shellfish' })]);
});

for (const width of [390, 1440]) {
  test(`a Free trainee’s finished profile at ${width}px reads the held health answers with no Edit, light and dark, at 200% text`, async ({
    page,
  }) => {
    await openMyProfile(page, width, { profile: finishedProfile(OFF_MAX) });

    await expect(page.locator('.panel-head h2')).toHaveText([
      'About you',
      'Your goal',
      'Your day and food',
      'Your health',
    ]);
    const health = page.locator('section.panel', { has: page.locator('#intake-health') });
    await expect(health.locator('[data-health-closed]')).toHaveText(CLOSED_NOTE);
    await expect(health).toContainText('Peanuts');
    await expect(health.getByRole('button')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Edit/ })).toHaveCount(3);
    await expectNoHorizontalOverflow(page);
    await axe(page);
    await page.screenshot({ path: `test-results/n9c5b-free-profile-${width}.png`, fullPage: true });

    await page.emulateMedia({ colorScheme: 'dark' });
    await page.reload();
    await expect(page.locator('[data-health-closed]')).toHaveText(CLOSED_NOTE);
    await axe(page);
    await page.screenshot({
      path: `test-results/n9c5b-free-profile-dark-${width}.png`,
      fullPage: true,
    });

    await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
    await expectNoHorizontalOverflow(page);
    await page.screenshot({
      path: `test-results/n9c5b-free-profile-200-${width}.png`,
      fullPage: true,
    });
  });
}

test('a Free trainee with no health answers held has no Health card at all', async ({ page }) => {
  await openMyProfile(page, 390, {
    profile: finishedProfile({
      ...OFF_MAX,
      allergies: null,
      medications: null,
      previousInjuries: null,
    }),
  });

  await expect(page.locator('.panel-head h2')).toHaveText([
    'About you',
    'Your goal',
    'Your day and food',
  ]);
  await expect(page.locator('[data-health-closed]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Edit/ })).toHaveCount(3);
  await axe(page);
});

test.describe('when Max ends under the Health step', () => {
  // The browser logs the refused request itself; what matters is what the page says and does.
  test.use({ allowedConsoleErrors: { patterns: [/status of 409 .*\/api\/client-profile/] } });

  test('the first run says why on Weight, the step is gone, and leaving asks nothing', async ({
    page,
  }) => {
    const writes = await openMyProfile(page, 390, {
      profile: halfwayProfile({ ...ON_MAX, workType: 'Teacher' }),
      maxEndsOnSave: true,
    });

    await stepHeading(page, 'Your health');
    await page.getByLabel('Allergies (optional)').fill('Shellfish');
    await page.getByRole('button', { name: 'Continue' }).click();

    const refusal = page.locator('app-form-summary');
    await expect(refusal).toHaveText(CLOSED_REFUSAL);
    await expect(refusal).toBeFocused();
    await stepHeading(page, 'Where you start');
    await expect(page.locator('.kicker')).toHaveText('Step 4 of 4');
    await expect(page.locator('.progress .item')).toHaveCount(4);
    await expectNoHorizontalOverflow(page);
    await axe(page);
    await page.screenshot({ path: 'test-results/n9c5b-health-closed-step-390.png' });

    // Nothing typed on the closed step can be saved, so the leave warning stays off.
    await page.getByRole('link', { name: 'Me', exact: true }).first().click();
    await expect(page).toHaveURL(/\/me$/);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(writes.saved).toEqual([expect.objectContaining({ allergies: 'Shellfish' })]);
  });

  test('the health sheet keeps the words, sends nothing more, and its Edit is gone', async ({
    page,
  }) => {
    const writes = await openMyProfile(page, 390, {
      profile: finishedProfile(ON_MAX),
      maxEndsOnSave: true,
    });

    await page.getByRole('button', { name: 'Edit Your health' }).click();
    const sheet = page.getByRole('dialog');
    await sheet.getByLabel('Allergies (optional)').fill('Shellfish');
    await sheet.getByRole('button', { name: 'Save changes' }).click();

    await expect(sheet.locator('app-form-summary')).toHaveText(CLOSED_REFUSAL);
    await expectNoHorizontalOverflow(page);
    await axe(page);
    await page.screenshot({ path: 'test-results/n9c5b-health-closed-sheet-390.png' });
    // The read already says so: pressing again sends nothing, waited for rather than assumed.
    const another = page
      .waitForRequest(
        (request) =>
          request.method() === 'PUT' && request.url().endsWith('/api/client-profile/me/intake'),
        { timeout: 1000 },
      )
      .then(
        () => true,
        () => false,
      );
    await sheet.getByRole('button', { name: 'Save changes' }).click();
    expect(await another).toBe(false);
    await expect(sheet.locator('app-form-summary')).toHaveText(CLOSED_REFUSAL);
    expect(writes.saved).toHaveLength(1);

    // Nothing in it can be saved, so Not now closes it without asking.
    await sheet.getByRole('button', { name: 'Not now' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('[data-health-closed]')).toHaveText(CLOSED_NOTE);
    await expect(page.getByRole('button', { name: 'Edit Your health' })).toHaveCount(0);
    await expect(page.locator('.answer', { hasText: 'Allergies' })).toContainText('Peanuts');
  });
});

// ---------- the coach's view ----------

const CLIENT_ID = 'client-1';
// Karim owns the space and coaches Rana: only a client's own coach reads their intake (N9d1a).
const OWNER = { ...SIGNED_IN_USER, id: COACH_USER_ID, displayName: 'Karim Haddad' };

async function openClientIntake(
  page: Page,
  options: {
    details?: CoachClientDetails;
    dark?: boolean;
    width?: number;
    /** The client's Max ends just before the first save lands (N9c5a). */
    maxEndsOnSave?: boolean;
  } = {},
) {
  await page.clock.setFixedTime(new Date(NOW));
  await page.emulateMedia({ colorScheme: options.dark ? 'dark' : 'light' });
  await page.setViewportSize({ width: options.width ?? 1440, height: 900 });
  let details = options.details ?? coachView();
  let maxEnds = options.maxEndsOnSave === true;
  const writes: Writes = { saved: [], completed: [] };
  await mockSession(page, {
    memberships: [OWNER_MEMBERSHIP],
    user: OWNER,
    extra: {
      [`GET /api/clients/${CLIENT_ID}`]: (route) => json(route, 200, details),
      // The client's header reads what waits for the coach; nothing does here.
      [`GET /api/clients/${CLIENT_ID}/overview`]: (route) => json(route, 200, { attention: [] }),
      [`GET /api/commercial/clients/${CLIENT_ID}`]: (route) =>
        json(route, 200, {
          clientProfileId: CLIENT_ID,
          isRelationshipBlocked: false,
          featureAccess: [],
          enrollments: [],
        }),
      'GET /api/workspace': (route) => json(route, 200, workspace()),
      [`PUT /api/clients/${CLIENT_ID}/intake`]: (route) => {
        const body = route.request().postDataJSON() as Record<string, unknown>;
        writes.saved.push(body);
        if (maxEnds) {
          maxEnds = false;
          details = { ...details, healthStepOpen: false };
        }
        if (refusesHealth(details, body)) return json(route, 409, HEALTH_CLOSED);
        details = applyIntake(details, body);
        return json(route, 200, details);
      },
      [`POST /api/clients/${CLIENT_ID}/complete-onboarding`]: (route) => {
        const body = route.request().postDataJSON() as { intake: Record<string, unknown> };
        writes.completed.push(body);
        details = { ...applyIntake(details, body.intake), onboardingStatus: 'Completed' };
        return json(route, 200, details);
      },
    },
  });
  await page.goto(`/clients/${CLIENT_ID}/intake`);
  await expect(page.getByRole('heading', { level: 2, name: 'Client intake' })).toBeVisible();
  await waitForFonts(page);
  return writes;
}

test('the coach reads a client’s answers as cards, light and dark, and passes axe', async ({
  page,
}) => {
  await openClientIntake(page);

  await expect(page.getByText('The answers Rana gave when setting up.')).toBeVisible();
  await expect(page.locator('.panel-head h2')).toHaveText([
    'About Rana',
    'Rana’s goal',
    'Rana’s day and food',
    'Rana’s health',
  ]);
  await expect(page.getByRole('button', { name: /^Edit/ })).toHaveCount(4);
  await expectNoHorizontalOverflow(page);
  await axe(page);
  await page.screenshot({ path: 'test-results/r53b-coach-intake-1440.png', fullPage: true });

  await page.emulateMedia({ colorScheme: 'dark' });
  await page.reload();
  await expect(page.getByRole('heading', { level: 2, name: 'Client intake' })).toBeVisible();
  await axe(page);
  await page.screenshot({ path: 'test-results/r53b-coach-intake-dark-1440.png', fullPage: true });
});

test('the coach corrects a group in a sheet, and the page keeps what the server returned', async ({
  page,
}) => {
  const writes = await openClientIntake(page);

  await page.getByRole('button', { name: 'Edit About Rana' }).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByRole('heading', { name: 'About Rana' })).toBeVisible();
  await sheet.getByLabel('Phone number (optional)').fill('+96171999888');
  await page.screenshot({ path: 'test-results/r53b-coach-sheet-1440.png' });
  await sheet.getByRole('button', { name: 'Save changes' }).click();

  await expect(page.getByText('Rana’s details were saved.')).toBeVisible();
  await expect(page.locator('.answer', { hasText: 'Phone number' })).toContainText('+96171999888');
  expect(writes.saved).toEqual([
    expect.objectContaining({ phoneNumber: '+96171999888', version: 9, birthDate: '1996-04-02' }),
  ]);
});

test('the coach sees what a client still needs, and finishes setting up with the starting weight', async ({
  page,
}) => {
  const writes = await openClientIntake(page, { details: coachView(halfwayProfile()) });

  await expect(page.locator('.banner-text')).toHaveText(
    'Rana has not finished setting up. Their starting weight is the last thing needed.',
  );
  await axe(page);
  await page.screenshot({ path: 'test-results/r53b-coach-setup-1440.png', fullPage: true });

  await page.getByRole('button', { name: 'Finish setting up' }).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByRole('heading', { name: 'Starting weight' })).toBeVisible();
  await sheet.getByLabel('Weight', { exact: true }).fill('64.2');
  await sheet.getByRole('button', { name: 'Finish setting up' }).click();

  await expect(page.getByText('Rana has finished setting up.')).toBeVisible();
  await expect(page.locator('.setup')).toHaveCount(0);
  expect(writes.completed).toEqual([
    expect.objectContaining({
      initialBodyweightValue: 64.2,
      initialBodyweightUnit: 'Kilogram',
      measurementDate: '2026-10-10',
    }),
  ]);
});

test('the coach sees a client who has not answered anything, and cannot finish yet', async ({
  page,
}) => {
  await openClientIntake(page, { details: coachView(newProfile()), width: 390 });

  await expect(page.locator('.banner-text')).toContainText(
    'Still needed: date of birth, height, a goal, and starting weight.',
  );
  await expect(page.getByRole('button', { name: 'Finish setting up' })).toBeDisabled();
  await expectNoHorizontalOverflow(page);
  await axe(page);
  await page.screenshot({ path: 'test-results/r53b-coach-new-390.png', fullPage: true });
});

test('a former client’s answers are read and not edited', async ({ page }) => {
  await openClientIntake(page, {
    details: {
      ...coachView(),
      release: {
        releasedAtUtc: '2026-09-20T10:00:00Z',
        reason: 'Moved',
        releasedByName: 'Karim Haddad',
        departureKind: 'ReleasedByOwner',
      },
    },
  });

  await expect(
    page.getByText('Rana is a former client, so these answers can be read but not changed.'),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: /^Edit/ })).toHaveCount(0);
  await axe(page);
});

test('the owner on another coach’s client is told why the intake is closed, with nothing to edit (N9d1a)', async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date(NOW));
  await page.setViewportSize({ width: 1440, height: 900 });
  const writes: string[] = [];
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith('/api/') && request.method() !== 'GET') writes.push(path);
  });
  // The server withholds every answer from the owner while Lea coaches Rana.
  const withheld = {
    ...coachView(newProfile()),
    assignedCoachUserId: '00000000-0000-4000-8000-0000000000a2',
    assignedCoachName: 'Lea Khoury',
    mayCoach: false,
  };
  await mockSession(page, {
    memberships: [OWNER_MEMBERSHIP],
    user: OWNER,
    extra: {
      [`GET /api/clients/${CLIENT_ID}`]: (route) => json(route, 200, withheld),
      [`GET /api/clients/${CLIENT_ID}/overview`]: (route) => json(route, 200, { attention: [] }),
      [`GET /api/commercial/clients/${CLIENT_ID}`]: (route) =>
        json(route, 200, {
          clientProfileId: CLIENT_ID,
          isRelationshipBlocked: false,
          featureAccess: [],
          enrollments: [],
        }),
      'GET /api/workspace': (route) => json(route, 200, workspace()),
    },
  });
  await page.goto(`/clients/${CLIENT_ID}/intake`);

  const why = page.locator('.section-content section.why');
  await expect(why.getByRole('heading', { level: 2 })).toHaveText('Lea Khoury coaches Rana');
  await expect(why).toContainText(
    'Their training, nutrition, check-ins and progress open only to their coach.',
  );
  await expect(page.getByRole('heading', { level: 2, name: 'Client intake' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Edit/ })).toHaveCount(0);
  expect(writes).toEqual([]);
  await axe(page);
});

// ---------- the coach's view of a trainee of TB Gym's own space (N9c5a) ----------

test('the coach reads a Free trainee’s held health answers with no Edit on them, light and dark', async ({
  page,
}) => {
  await openClientIntake(page, {
    details: { ...coachView(finishedProfile()), healthStepOpen: false },
  });

  await expect(page.locator('.panel-head h2')).toHaveText([
    'About Rana',
    'Rana’s goal',
    'Rana’s day and food',
    'Rana’s health',
  ]);
  await expect(page.locator('[data-health-closed]')).toHaveText(CLOSED_NOTE);
  await expect(page.getByRole('button', { name: /^Edit/ })).toHaveCount(3);
  await expect(page.getByRole('button', { name: 'Edit Rana’s health' })).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
  await axe(page);
  await page.screenshot({ path: 'test-results/n9c5b-coach-free-intake-1440.png', fullPage: true });

  await page.emulateMedia({ colorScheme: 'dark' });
  await page.reload();
  await expect(page.locator('[data-health-closed]')).toHaveText(CLOSED_NOTE);
  await axe(page);
});

test('the coach of a Free trainee with no health answers held sees no Health card', async ({
  page,
}) => {
  await openClientIntake(page, {
    details: {
      ...coachView(finishedProfile({ allergies: null, medications: null, previousInjuries: null })),
      healthStepOpen: false,
    },
    width: 390,
  });

  await expect(page.locator('.panel-head h2')).toHaveText([
    'About Rana',
    'Rana’s goal',
    'Rana’s day and food',
  ]);
  await expectNoHorizontalOverflow(page);
  await axe(page);
});

test.describe('when a client’s Max ends under the coach’s health sheet', () => {
  test.use({ allowedConsoleErrors: { patterns: [/status of 409 .*\/api\/clients\//] } });

  test('the sheet says why in the client’s name, sends nothing more, and the Edit is gone', async ({
    page,
  }) => {
    const writes = await openClientIntake(page, { maxEndsOnSave: true });

    await page.getByRole('button', { name: 'Edit Rana’s health' }).click();
    const sheet = page.getByRole('dialog');
    await sheet.getByLabel('Allergies (optional)').fill('Shellfish');
    await sheet.getByRole('button', { name: 'Save changes' }).click();

    await expect(sheet.locator('app-form-summary')).toHaveText(
      'Health answers open on Max, TB Gym’s coaching. Rana’s other answers can still be saved.',
    );
    await axe(page);
    // The read already says so: pressing again sends nothing, waited for rather than assumed.
    const another = page
      .waitForRequest(
        (request) =>
          request.method() === 'PUT' && request.url().endsWith(`/api/clients/${CLIENT_ID}/intake`),
        { timeout: 1000 },
      )
      .then(
        () => true,
        () => false,
      );
    await sheet.getByRole('button', { name: 'Save changes' }).click();
    expect(await another).toBe(false);
    expect(writes.saved).toHaveLength(1);
    await sheet.getByRole('button', { name: 'Not now' }).click();

    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('[data-health-closed]')).toHaveText(CLOSED_NOTE);
    await expect(page.getByRole('button', { name: /^Edit/ })).toHaveCount(3);
  });
});
