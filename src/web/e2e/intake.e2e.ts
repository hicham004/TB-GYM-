import AxeBuilder from '@axe-core/playwright';
import type { Page, Route } from '@playwright/test';
import type { CoachClientDetails, ClientSelfProfile } from '../src/app/core/api/api.models';
import {
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
const COACH_ID = '00000000-0000-4000-8000-000000000e01';
const FIELD_WARNING = 'Check the fields marked above.';

type Handler = (route: Route) => Promise<void> | void;
interface Writes {
  saved: Record<string, unknown>[];
  completed: Record<string, unknown>[];
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
    extra?: Record<string, Handler>;
  } = {},
) {
  await page.clock.setFixedTime(new Date(NOW));
  await page.emulateMedia({ colorScheme: options.dark ? 'dark' : 'light' });
  await page.setViewportSize({ width, height: options.height ?? 900 });
  let profile = options.profile ?? newProfile();
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
        profile = applyIntake(profile, body);
        return json(route, 200, profile);
      },
      'POST /api/client-profile/me/complete-onboarding': (route) => {
        const body = route.request().postDataJSON() as { intake: Record<string, unknown> };
        writes.completed.push(body);
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
  await expect(page.locator('.privacy')).toHaveText(
    'Only you, your coach and the owner of Atlas Performance can see these answers.',
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

    const refusal = page.locator('.refusal');
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

// ---------- the coach's view ----------

const CLIENT_ID = 'client-1';
const OWNER = { ...SIGNED_IN_USER, id: COACH_ID, displayName: 'Karim Haddad' };

async function openClientIntake(
  page: Page,
  options: { details?: CoachClientDetails; dark?: boolean; width?: number } = {},
) {
  await page.clock.setFixedTime(new Date(NOW));
  await page.emulateMedia({ colorScheme: options.dark ? 'dark' : 'light' });
  await page.setViewportSize({ width: options.width ?? 1440, height: 900 });
  let details = options.details ?? coachView();
  const writes: Writes = { saved: [], completed: [] };
  await mockSession(page, {
    memberships: [OWNER_MEMBERSHIP],
    user: OWNER,
    extra: {
      [`GET /api/clients/${CLIENT_ID}`]: (route) => json(route, 200, details),
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
