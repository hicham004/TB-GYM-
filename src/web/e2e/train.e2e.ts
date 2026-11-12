import AxeBuilder from '@axe-core/playwright';
import type { Locator, Page, Route } from '@playwright/test';
import { finishedProfile } from '../src/testing/intake-fixtures';
import { personFacing } from './axe-target-size';
import {
  expect,
  expectNoHorizontalOverflow,
  json,
  mockSession,
  mockSignedOut,
  SIGNED_IN_USER,
  test,
  waitForFonts,
} from './support';

/**
 * TB Gym's own sign-up (notes plan N9a2) in a real browser: `/train` open, full and closed, for a
 * visitor and for someone signed in, and the form at `/train/sign-up`, sent, refused in words, and
 * turned into what `/train` says when sign-up closes or fills meanwhile; and Open Today, which opens
 * TB Gym's space for someone who is also a coach's client. Every answer is a test-only
 * mock of N9a1's API; the pages, their guards and the stores run unchanged. The house keeps Beirut's
 * clock while the device is on UTC here and on Kiritimati's in the far-zone project, so both read the
 * line about the device's own clock.
 */
type Handler = (route: Route) => Promise<void> | void;

/** A Thursday in November, when Beirut is two hours ahead of UTC. */
const NOW = '2026-11-12T09:00:00Z';
const HOUSE_NAME = 'TB Gym coaching space';
const HOUSE = {
  tenantId: '00000000-0000-4000-8000-0000000000f1',
  tenantName: HOUSE_NAME,
  tenantSlug: 'tb-gym-coaching-space',
  role: 'Client',
};
/** Someone with an account and no coaching space, who signs up with it (decision 34). */
const NOUR = {
  ...SIGNED_IN_USER,
  id: '00000000-0000-4000-8000-0000000000c9',
  email: 'nour@example.test',
  displayName: 'Nour Khalil',
};
/**
 * A coach's space Nour is also a client in (decision 34). Its name comes first, as the server orders the
 * list, so it is the space chosen when the app starts.
 */
const ATLAS = {
  tenantId: '00000000-0000-4000-8000-0000000000a7',
  tenantName: 'Atlas Performance',
  tenantSlug: 'atlas-performance',
  role: 'Client',
};
const PASSWORD = 'Correct-Horse-2026!';
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];

/** `GET /api/auth/register/trainee` while sign-up is open, from age 19. */
function openStatus(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    status: 'Open',
    workspaceName: HOUSE_NAME,
    timeZoneId: 'Asia/Beirut',
    minimumAge: 19,
    opensAgainOn: null,
    formStamp: 'e2e-form-stamp',
    callerSignUp: null,
    ...overrides,
  };
}

/** Full for the week; the house's next week starts on a Saturday, so the weekday is the house's own. */
const FULL = openStatus({ status: 'Full', opensAgainOn: '2026-11-14', formStamp: null });
/** Closed, as the server answers it: nothing more, not even the house's name. */
const CLOSED = {
  status: 'Closed',
  workspaceName: null,
  timeZoneId: null,
  minimumAge: null,
  opensAgainOn: null,
  formStamp: null,
  callerSignUp: null,
};

/** A new account, waiting for its emailed link (202). */
const created = (email: string) => ({
  email,
  developmentConfirmationUrl: null,
  emailAvailable: true,
  joined: false,
});

const refuse =
  (status: number, body: object): Handler =>
  (route) =>
    json(route, status, body);

/** Today for a trainee of the house: Training alone, nothing in it yet, and no coach (CLI-026). */
const TRAINEE_TODAY: Record<string, Handler> = {
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
    json(
      route,
      200,
      finishedProfile({
        firstName: 'Nour',
        lastName: 'Khalil',
        email: NOUR.email,
        selfDirected: true,
      }),
    ),
  'GET /api/training/me/today': (route) =>
    json(route, 200, {
      isAllowed: true,
      accessReason: 'Granted',
      localDate: '2026-11-12',
      workouts: [],
    }),
  'GET /api/training/me/upcoming': (route) =>
    json(route, 200, {
      isAllowed: true,
      accessReason: 'Granted',
      localDate: '2026-11-12',
      timeZoneId: 'Asia/Beirut',
      hasAssignedProgram: false,
      hasVisibleSessions: true,
      searchThrough: '2027-02-10',
      nextSession: null,
      unfinishedWorkouts: [],
      nextSkip: null,
      todayCoverage: { activeBlock: null, nextBlockStartDate: null },
    }),
  'GET /api/training/me/week': (route) =>
    json(route, 200, {
      isAllowed: true,
      accessReason: 'Granted',
      localDate: '2026-11-12',
      weekStart: '2026-11-09',
      days: ['09', '10', '11', '12', '13', '14', '15'].map((date) => ({
        date: `2026-11-${date}`,
        scheduled: 0,
        completed: 0,
      })),
    }),
  'GET /api/client-renewal/me': (route) =>
    json(route, 200, {
      planEnded: false,
      endedOn: null,
      coachName: null,
      lastRequest: null,
      canAsk: false,
    }),
  'GET /api/client-plan/me': (route) =>
    json(route, 200, { today: '2026-11-12', plans: [], coachName: null }),
  'GET /api/messaging/conversations': (route) =>
    json(route, 200, {
      items: [],
      hasMore: false,
      nextBeforeActivityAtUtc: null,
      nextBeforeConversationId: null,
    }),
};

/** What the form sent, and the security token's reads and the sign-ups in the order the page made them. */
interface SignUps {
  readonly sent: Record<string, unknown>[];
  readonly order: string[];
}

/**
 * A visitor on the sign-up's pages. `status` is read on every visit, so a test can change it between
 * them; each sign-up takes the next of `answers`, and a new account is created once they run out.
 */
async function asVisitor(
  page: Page,
  status: () => object = () => openStatus(),
  answers: Handler[] = [],
): Promise<SignUps> {
  const record: SignUps = { sent: [], order: [] };
  await page.clock.setFixedTime(new Date(NOW));
  await mockSignedOut(page, {
    'GET /api/auth/csrf': (route) => {
      record.order.push('token');
      return json(route, 200, { token: 'e2e-csrf' });
    },
    'GET /api/auth/register/trainee': (route) => json(route, 200, status()),
    'POST /api/auth/register/trainee': (route) => {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      record.order.push('sign-up');
      record.sent.push(body);
      const answer = answers.shift();
      return answer ? answer(route) : json(route, 202, created(String(body['email'])));
    },
  });
  return record;
}

/** Nour, signed in; the memberships and the status are read on every visit. */
async function asSignedIn(
  page: Page,
  memberships: () => (typeof HOUSE)[],
  status: () => object,
  extra: Record<string, Handler> = {},
): Promise<void> {
  await page.clock.setFixedTime(new Date(NOW));
  await mockSession(page, {
    user: NOUR,
    extra: {
      'GET /api/tenants': (route) => json(route, 200, memberships()),
      'GET /api/auth/register/trainee': (route) => json(route, 200, status()),
      ...TRAINEE_TODAY,
      ...extra,
    },
  });
}

async function open(page: Page, path: string, width = 390): Promise<void> {
  await page.setViewportSize({ width, height: width < 600 ? 844 : 900 });
  await page.goto(path);
  await ready(page);
}

async function ready(page: Page): Promise<void> {
  await expect(page.locator('h1')).toBeVisible();
  await waitForFonts(page);
  await page.evaluate(() => document.fonts.load('italic 400 14px "TB Home Serif"'));
}

/** Axe as a person meets the page; a target the client's tab bar covers is judged where it is reached. */
async function expectAccessible(page: Page): Promise<void> {
  const result = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
  expect(
    (await personFacing(page, result.violations)).map(
      (violation) =>
        `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).join(', ')}`,
    ),
  ).toEqual([]);
}

/** Where a link leads, and the page sign-in sends the person back to. */
async function target(link: Locator): Promise<{ path: string; returnUrl: string | null }> {
  const url = new URL((await link.getAttribute('href')) ?? '', 'http://localhost');
  return { path: url.pathname, returnUrl: url.searchParams.get('returnUrl') };
}

/**
 * Beirut's midnight on this project's device clock in November: 22:00 in UTC, noon in Kiritimati. The
 * space before AM or PM may be a narrow one, so it is matched as any space.
 */
function abroadLine(): RegExp {
  const time = test.info().project.use.timezoneId === 'Pacific/Kiritimati' ? '12:00' : '10:00';
  return new RegExp(`^On your device’s clock, a new training day starts at ${time}\\sPM\\.$`);
}

/** The form as Nour fills it; signed in, the email and passwords are not asked. */
async function fillForm(
  page: Page,
  options: { birth?: [string, string, string]; signedIn?: boolean } = {},
): Promise<void> {
  const [day, month, year] = options.birth ?? ['27', '3', '1995'];
  await page.getByLabel('First name').fill('Nour');
  await page.getByLabel('Last name').fill('Khalil');
  if (!options.signedIn) {
    await page.getByLabel('Email').fill(NOUR.email);
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await page.getByLabel('Confirm password').fill(PASSWORD);
  }
  await page.getByLabel('Day', { exact: true }).fill(day);
  await page.getByLabel('Month', { exact: true }).fill(month);
  await page.getByLabel('Year', { exact: true }).fill(year);
}

/**
 * The frame a visitor meets: from 64rem the photo and its line, and never the summary written for
 * coaches, which names meals, check-ins and messages a trainee on Free does not get.
 */
async function expectTraineeFrame(page: Page, width: number): Promise<void> {
  await expect(page.locator('.auth__summary')).toHaveCount(0);
  if (width < 1024) return;
  const panel = page.locator('.auth__panel');
  await expect(panel).toBeVisible();
  await expect(panel.locator('.auth__tagline')).toHaveText('The work behind every win.');
  expect(
    await panel
      .locator('.auth__scene')
      .evaluate((scene) => getComputedStyle(scene).backgroundImage),
  ).toContain('coaching-hero');
}

/** The space each read was asked in, by its `X-Tenant-Id`: the sign-up's status, and Today's own. */
interface SpacesAsked {
  readonly status: (string | null)[];
  readonly today: (string | null)[];
}

function spacesAsked(page: Page): SpacesAsked {
  const asked: SpacesAsked = { status: [], today: [] };
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    const space = request.headers()['x-tenant-id'] ?? null;
    if (request.method() === 'GET' && path === '/api/auth/register/trainee') {
      asked.status.push(space);
    }
    if (/^\/api\/(training|client-profile|client-access)\/me(\/|$)/.test(path)) {
      asked.today.push(space);
    }
  });
  return asked;
}

/** Today opened in TB Gym's space: each of its reads was asked there, and the chip names it. */
async function expectTodayInTheHouse(page: Page, asked: SpacesAsked): Promise<void> {
  await expect(page).toHaveURL('/');
  await expect(page.locator('#today-training-heading')).toHaveText('No workouts yet');
  await expect(page.locator('.row-skeleton')).toHaveCount(0);
  await expect(page.locator('.today-coach[data-self-directed] .tb-visually-hidden')).toHaveText(
    `Self-directed · ${HOUSE_NAME}`,
  );
  expect(asked.today.length).toBeGreaterThan(0);
  expect([...new Set(asked.today)]).toEqual([HOUSE.tenantId]);
}

/** Text twice its size, applied again after each visit. */
async function bigText(page: Page): Promise<void> {
  await page.evaluate(() => (document.documentElement.style.fontSize = '32px'));
}

const robots = (page: Page) => page.locator('head meta[name="robots"]');

for (const width of [390, 1440]) {
  test(`/train at ${width}px offers TB Gym’s coaching, says whose clock training days follow, and Create your account opens the form`, async ({
    page,
  }) => {
    const record = await asVisitor(page);
    await open(page, '/train', width);

    await expect(page).toHaveTitle('Train with TB Gym');
    await expect(page.locator('.auth-eyebrow')).toHaveText(HOUSE_NAME);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Train with TB Gym.');
    await expect(page.locator('.auth-lead')).toHaveText(
      'Train on your own, with no coach. Pick exercises, log your workouts and keep your history.',
    );
    await expect(page.locator('[data-clock]')).toHaveText('Training days follow Beirut time.');
    await expect(page.locator('[data-abroad]')).toHaveText(abroadLine());
    await expect(page.getByText('Creating an account is free.')).toBeVisible();
    expect(await target(page.getByRole('link', { name: 'Sign in' }))).toEqual({
      path: '/auth/sign-in',
      returnUrl: '/train',
    });
    await expectTraineeFrame(page, width);
    await expectNoHorizontalOverflow(page);
    await expectAccessible(page);
    await page.screenshot({ path: test.info().outputPath(`train-open-${width}.png`) });

    await page.getByRole('link', { name: 'Create your account' }).click();
    await expect(page).toHaveURL('/train/sign-up');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Create your account.');
    // One title for a visitor and for someone signed in, who creates no account.
    await expect(page).toHaveTitle('Sign up | Train with TB Gym');
    await expect(page.locator('.auth-eyebrow')).toHaveText(HOUSE_NAME);
    await expectTraineeFrame(page, width);
    for (const label of ['First name', 'Last name', 'Email', 'Confirm password']) {
      await expect(page.getByLabel(label)).toBeVisible();
    }
    await expect(page.getByLabel('Password', { exact: true })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Date of birth' })).toContainText(
      'For example, 27 3 1990.',
    );
    // Nothing is published for a trainee here, so no box is asked.
    await expect(page.locator('fieldset[data-legal]')).toHaveCount(0);
    expect(await target(page.locator('.auth-alt').getByRole('link', { name: 'Sign in' }))).toEqual({
      path: '/auth/sign-in',
      returnUrl: '/train/sign-up',
    });
    await expectNoHorizontalOverflow(page);
    await expectAccessible(page);
    expect(record.sent).toEqual([]);
  });

  test(`/train at ${width}px says when a full week opens again, on the house’s weekday, and offers a visitor Sign in; while closed it names no house; neither offers a button`, async ({
    page,
  }) => {
    let status: object = FULL;
    await asVisitor(page, () => status);
    await open(page, '/train', width);

    await expect(page.locator('.auth-eyebrow')).toHaveText(HOUSE_NAME);
    await expect(page.locator('[data-full]')).toHaveText(
      'Sign-up is full for this week. It opens again on Saturday.',
    );
    await expect(page.locator('[data-clock]')).toHaveText('Training days follow Beirut time.');
    await expect(page.getByRole('link', { name: 'Create your account' })).toHaveCount(0);
    await expect(page.locator('.auth-submit')).toHaveCount(0);
    expect(
      await target(
        page.locator('[data-status="Full"] .auth-alt').getByRole('link', { name: 'Sign in' }),
      ),
    ).toEqual({ path: '/auth/sign-in', returnUrl: '/train' });
    await expect(page.getByRole('link', { name: 'Sign in' })).toHaveCount(1);
    await expect(page.getByText('Creating an account is free.')).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await expectAccessible(page);
    await page.screenshot({ path: test.info().outputPath(`train-full-${width}.png`) });

    status = CLOSED;
    await page.reload();
    await ready(page);
    const closed = page.locator('[data-closed]');
    await expect(closed.locator('.auth-message')).toHaveText('Sign-up is closed right now.');
    await expect(closed).toContainText(
      'If a coach invited you, open the link in their email instead.',
    );
    await expect(page.locator('.auth-eyebrow')).toHaveText('TB Gym');
    await expect(page.locator('main')).not.toContainText(HOUSE_NAME);
    await expect(page.locator('.auth-lead')).toHaveCount(0);
    await expect(page.locator('[data-clock]')).toHaveCount(0);
    await expect(page.locator('.auth-submit')).toHaveCount(0);
    expect(await target(closed.getByRole('link', { name: 'Sign in' }))).toEqual({
      path: '/auth/sign-in',
      returnUrl: null,
    });
    await expectNoHorizontalOverflow(page);
    await expectAccessible(page);
    await page.screenshot({ path: test.info().outputPath(`train-closed-${width}.png`) });
  });

  test(`signed in at ${width}px, /train offers Sign up with this account, while full offers no sign-in, then says when the person is waiting or already joined`, async ({
    page,
  }) => {
    let memberships: (typeof HOUSE)[] = [];
    let status: object = openStatus();
    await asSignedIn(
      page,
      () => memberships,
      () => status,
    );
    await open(page, '/train', width);

    // The app's own bar is on screen, so the frame drops its wordmark and its photo.
    await expect(page.locator('.auth__header')).toHaveCount(0);
    await expect(page.locator('.auth__panel')).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Sign up with this account' })).toHaveAttribute(
      'href',
      '/train/sign-up',
    );
    await expect(page.getByRole('link', { name: 'Create your account' })).toHaveCount(0);
    await expect(page.locator('.auth-alt')).toHaveCount(0);
    await expect(page.getByText('Creating an account is free.')).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
    await expectAccessible(page);

    // Full while this account has not signed up: nothing to sign in to, and no form.
    status = FULL;
    await page.reload();
    await ready(page);
    await expect(page.locator('[data-full]')).toHaveText(
      'Sign-up is full for this week. It opens again on Saturday.',
    );
    await expect(page.getByRole('link', { name: 'Sign in' })).toHaveCount(0);
    await expect(page.locator('.auth-submit')).toHaveCount(0);
    await expect(page.getByText('Creating an account is free.')).toHaveCount(0);

    status = openStatus({ callerSignUp: 'Waiting' });
    await page.reload();
    await ready(page);
    await expect(page.locator('[data-waiting]')).toHaveText(
      'Your email is confirmed, and a place is open now.',
    );
    await expect(page.getByRole('link', { name: 'Finish signing up' })).toHaveAttribute(
      'href',
      '/train/sign-up',
    );
    await expect(page.getByRole('link', { name: 'Sign up with this account' })).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
    await expectAccessible(page);

    status = { ...FULL, callerSignUp: 'Waiting' };
    await page.reload();
    await ready(page);
    await expect(page.locator('[data-full]')).toHaveText(
      'Sign-up is full for this week. It opens again on Saturday.',
    );
    await expect(page.locator('[data-waiting]')).toHaveText(
      'Your email is confirmed and your sign-up is waiting for a place. Come back then to finish it.',
    );
    await expect(page.locator('.auth-submit')).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
    await expectAccessible(page);

    memberships = [HOUSE];
    status = openStatus({ callerSignUp: 'Joined' });
    await page.reload();
    await ready(page);
    await expect(page.locator('.auth-message--success')).toHaveText(
      'You’re already training with TB Gym.',
    );
    await expect(page.getByRole('link', { name: 'Open Today' })).toHaveAttribute('href', '/');
    await expect(page.getByRole('link', { name: /Sign up|Finish signing up/ })).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
    await expectAccessible(page);
    await page.screenshot({ path: test.info().outputPath(`train-joined-${width}.png`) });
  });

  test(`a visitor’s form at ${width}px sends what was typed with the form’s stamp, then says to check their email`, async ({
    page,
  }) => {
    const record = await asVisitor(page);
    await open(page, '/train/sign-up', width);
    // The house's age is a setting; the sentence a form shows before sending is the lawyer's, so none is.
    await expect(page.locator('main')).not.toContainText(/aged|or older/);
    await fillForm(page);
    await expectNoHorizontalOverflow(page);
    await expectAccessible(page);
    record.order.length = 0;

    await page.getByRole('button', { name: 'Create account' }).click();

    const answer = page.locator('[data-registered]');
    await expect(answer.getByRole('heading', { name: 'Check your email' })).toBeFocused();
    await expect(answer).toContainText(
      'We sent a link to nour@example.test. Open it to finish signing up.',
    );
    await expect(answer).toContainText(
      'The link works for one day. This week’s places go to the people who open their link first.',
    );
    await expect(answer.getByRole('link', { name: 'Return to sign in' })).toHaveAttribute(
      'href',
      '/auth/sign-in',
    );
    await expect(answer.getByRole('link', { name: 'Open development confirmation' })).toHaveCount(
      0,
    );
    await expect(page.locator('form')).toHaveCount(0);
    expect(record.sent).toEqual([
      {
        firstName: 'Nour',
        lastName: 'Khalil',
        email: 'nour@example.test',
        birthDate: '1995-03-27',
        password: PASSWORD,
        website: '',
        legalDocumentIds: [],
        formStamp: 'e2e-form-stamp',
      },
    ]);
    // A fresh security token first: a mock accepts any, so the order is what is pinned.
    expect(record.order).toEqual(['token', 'sign-up']);
    await expectNoHorizontalOverflow(page);
    await expectAccessible(page);
    await page.screenshot({ path: test.info().outputPath(`train-sent-${width}.png`) });
  });
}

test.describe('a refused sign-up', () => {
  // A refusal logs its failed request, which is the point of it.
  test.use({ allowedConsoleErrors: { patterns: [/status of (400|403|409|429)/] } });

  test('an age under the house’s is said under Date of birth, and an email with an account offers signing in back to the form', async ({
    page,
  }) => {
    const record = await asVisitor(page, () => openStatus(), [
      refuse(409, {
        code: 'trainee_sign_up_age_not_met',
        message: 'Sign-up is open to people aged 19 or older.',
        minimumAge: 19,
      }),
      refuse(409, {
        code: 'existing_account_sign_in_required',
        message: 'An account already uses this email. Sign in with it, then sign up from there.',
      }),
    ]);
    await open(page, '/train/sign-up');
    await fillForm(page, { birth: ['14', '5', '2010'] });
    await page.getByRole('button', { name: 'Create account' }).click();

    const summary = page.locator('#train-summary');
    await expect(summary).toHaveText('Sign-up is open to people aged 19 or older.');
    await expect(summary).toBeFocused();
    const birth = page.locator('app-date-input');
    await expect(birth.locator('.tb-field__support--error')).toHaveText(
      'Sign-up is open to people aged 19 or older.',
    );
    await expect(page.getByLabel('Year', { exact: true })).toHaveAttribute('aria-invalid', 'true');
    expect(record.sent).toEqual([expect.objectContaining({ birthDate: '2010-05-14' })]);
    await expectNoHorizontalOverflow(page);
    await expectAccessible(page);
    await page.screenshot({ path: test.info().outputPath('train-refused-age-390.png') });

    // The server's sentence goes as soon as the date changes.
    await page.getByLabel('Year', { exact: true }).fill('1995');
    await expect(birth.locator('.tb-field__support--error')).toHaveCount(0);
    await page.getByRole('button', { name: 'Create account' }).click();

    await expect(summary).toContainText(
      'An account already uses this email. Sign in with it, then sign up from there. If you already signed up here, open the link in the email we sent you; if that link has stopped working, sign up again in a few days.',
    );
    await expect(summary).toBeFocused();
    expect(await target(summary.getByRole('link', { name: 'Sign in' }))).toEqual({
      path: '/auth/sign-in',
      returnUrl: '/train/sign-up',
    });
    await expect(summary.getByRole('link', { name: 'Reset your password' })).toHaveAttribute(
      'href',
      '/auth/forgot-password',
    );
    // Sent once more, the passwords are asked again; the rest stays as typed.
    await expect(page.getByLabel('Password', { exact: true })).toHaveValue('');
    await expect(page.getByLabel('Confirm password')).toHaveValue('');
    await expect(page.getByLabel('Email')).toHaveValue('nour@example.test');
    expect(record.sent).toHaveLength(2);
    expect(record.sent[1]).toMatchObject({ birthDate: '1995-05-14' });
    await expectNoHorizontalOverflow(page);
    await expectAccessible(page);
    await page.screenshot({ path: test.info().outputPath('train-refused-account-390.png') });
  });

  for (const turn of [
    {
      what: 'closes',
      refusal: { code: 'trainee_sign_up_closed', message: 'Sign-up is not open right now.' },
      state: '[data-closed]',
      words: 'Sign-up is closed right now.',
      eyebrow: 'TB Gym',
    },
    {
      what: 'fills',
      refusal: {
        code: 'trainee_sign_up_full',
        message: 'Sign-up is full for this week. It opens again on Sunday.',
        opensAgainOn: '2026-11-15',
      },
      state: '[data-full]',
      words: 'Sign-up is full for this week. It opens again on Sunday.',
      eyebrow: HOUSE_NAME,
    },
  ]) {
    test(`sign-up that ${turn.what} while the form is open turns the page into what /train says`, async ({
      page,
    }) => {
      const record = await asVisitor(page, () => openStatus(), [refuse(409, turn.refusal)]);
      await open(page, '/train/sign-up');
      await fillForm(page);
      await page.getByRole('button', { name: 'Create account' }).click();

      const state = page.locator(turn.state);
      await expect(state.locator('.auth-message')).toHaveText(turn.words);
      await expect(state.locator('.auth-message')).toBeFocused();
      await expect(page.locator('form')).toHaveCount(0);
      await expect(page.locator('.auth-eyebrow')).toHaveText(turn.eyebrow);
      if (turn.what === 'closes') await expect(page.locator('main')).not.toContainText(HOUSE_NAME);
      await expect(state.getByRole('link', { name: 'Back to Train with TB Gym' })).toHaveAttribute(
        'href',
        '/train',
      );
      expect(record.sent).toHaveLength(1);
      await expectNoHorizontalOverflow(page);
      await expectAccessible(page);
    });
  }

  test('signed in with another account than the server sees, the form says so and offers Sign out and continue', async ({
    page,
  }) => {
    await asSignedIn(
      page,
      () => [],
      () => openStatus(),
      {
        'POST /api/auth/register/trainee': refuse(403, {
          code: 'wrong_signed_in_account',
          message: 'You are signed in with a different email. Use that email, or sign out first.',
        }),
      },
    );
    await open(page, '/train/sign-up');
    await fillForm(page, { signedIn: true });
    await page.getByRole('button', { name: 'Sign up', exact: true }).click();

    const summary = page.locator('#train-summary');
    await expect(summary).toHaveText(
      'You are signed in with a different email. Use that email, or sign out first.',
    );
    await expect(summary).toBeFocused();
    await expect(page.getByRole('button', { name: 'Sign out and continue' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign up', exact: true })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await expectAccessible(page);
    await page.screenshot({ path: test.info().outputPath('train-refused-wrong-account-390.png') });
  });

  test('a trainee already in the house is told so on sending, and Open Today opens TB Gym’s space though this page read the spaces before joining', async ({
    page,
  }) => {
    let memberships = [ATLAS];
    const asked = spacesAsked(page);
    await asSignedIn(
      page,
      () => memberships,
      () => openStatus(),
      {
        'POST /api/auth/register/trainee': refuse(409, {
          code: 'trainee_already_joined',
          message: 'You are already part of this coaching space.',
        }),
      },
    );
    await open(page, '/train/sign-up');
    await fillForm(page, { signedIn: true });
    // Joined in another tab meanwhile: the list this page read holds Atlas alone.
    memberships = [ATLAS, HOUSE];
    await page.getByRole('button', { name: 'Sign up', exact: true }).click();

    const summary = page.locator('#train-summary');
    await expect(summary).toContainText('You are already part of this coaching space.');
    await expect(summary).toBeFocused();
    const today = summary.getByRole('link', { name: 'Open Today' });
    await expect(today).toHaveAttribute('href', '/');
    await expectNoHorizontalOverflow(page);
    await expectAccessible(page);
    await page.screenshot({ path: test.info().outputPath('train-refused-joined-390.png') });

    expect([...new Set(asked.status)]).toEqual([ATLAS.tenantId]);
    asked.today.length = 0;
    await today.click();
    await expectTodayInTheHouse(page, asked);
  });
});

test('search engines are told to leave /train out while sign-up is closed, never while it is open, and to leave the form out always', async ({
  page,
}) => {
  let status: object = CLOSED;
  await asVisitor(page, () => status);
  await open(page, '/train');
  await expect(page.locator('[data-closed]')).toBeVisible();
  await expect(robots(page)).toHaveCount(1);
  await expect(robots(page)).toHaveAttribute('content', 'noindex');

  // The tag leaves with the page that added it.
  await page.getByRole('link', { name: 'Sign in' }).click();
  await expect(page).toHaveURL('/auth/sign-in');
  await expect(robots(page)).toHaveCount(0);

  status = openStatus();
  await open(page, '/train');
  await expect(page.getByRole('link', { name: 'Create your account' })).toBeVisible();
  await expect(robots(page)).toHaveCount(0);
  await page.getByRole('link', { name: 'Create your account' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Create your account.');
  await expect(robots(page)).toHaveCount(1);
  await expect(robots(page)).toHaveAttribute('content', 'noindex');
});

test('signed in, signing up with the account joins at once and opens Today in TB Gym’s space, with no coach to ask for', async ({
  page,
}) => {
  let joined = false;
  const sent: unknown[] = [];
  const coachReads: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/client-profile/me/coach') {
      coachReads.push(request.url());
    }
  });
  await asSignedIn(
    page,
    () => (joined ? [HOUSE] : []),
    () => openStatus(),
    {
      'POST /api/auth/register/trainee': (route) => {
        sent.push(route.request().postDataJSON());
        joined = true;
        return json(route, 200, {
          email: NOUR.email,
          developmentConfirmationUrl: null,
          emailAvailable: true,
          joined: true,
        });
      },
    },
  );
  await open(page, '/train');
  await page.getByRole('link', { name: 'Sign up with this account' }).click();

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Sign up to train.');
  await expect(page.locator('.train-account')).toHaveText('Sign up using nour@example.test.');
  await expect(page.getByLabel('Email')).toHaveCount(0);
  await expect(page.getByLabel('Password', { exact: true })).toHaveCount(0);
  await expect(page.locator('.auth-alt')).toHaveCount(0);
  await fillForm(page, { signedIn: true });
  await expectNoHorizontalOverflow(page);
  await expectAccessible(page);
  await page.getByRole('button', { name: 'Sign up', exact: true }).click();

  await expect(page).toHaveURL('/');
  await expect(page).toHaveTitle('Today | TB Gym');
  await expect(page.locator('#today-training-heading')).toHaveText('No workouts yet');
  await expect(page.locator('.today-coach[data-self-directed] .tb-visually-hidden')).toHaveText(
    `Self-directed · ${HOUSE_NAME}`,
  );
  expect(sent).toEqual([
    {
      firstName: 'Nour',
      lastName: 'Khalil',
      email: 'nour@example.test',
      birthDate: '1995-03-27',
      password: null,
      website: '',
      legalDocumentIds: [],
      formStamp: 'e2e-form-stamp',
    },
  ]);
  expect(coachReads).toEqual([]);
});

for (const path of ['/train', '/train/sign-up']) {
  test(`on ${path}, Open Today takes someone already training with TB Gym who is also a coach’s client to Today in TB Gym’s space`, async ({
    page,
  }) => {
    const asked = spacesAsked(page);
    await asSignedIn(
      page,
      () => [ATLAS, HOUSE],
      () => openStatus({ callerSignUp: 'Joined' }),
    );
    await open(page, path);

    await expect(page.locator('.auth-message--success')).toHaveText(
      'You’re already training with TB Gym.',
    );
    // The page was read in the coach's space, the one chosen first.
    expect([...new Set(asked.status)]).toEqual([ATLAS.tenantId]);
    if (path === '/train/sign-up') {
      await expect(page.locator('[data-joined]')).toBeVisible();
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Sign up to train.');
      await expect(page.locator('form')).toHaveCount(0);
      await expectNoHorizontalOverflow(page);
      await expectAccessible(page);
      await page.screenshot({ path: test.info().outputPath('train-form-joined-390.png') });
    }

    asked.today.length = 0;
    await page.getByRole('link', { name: 'Open Today' }).click();
    await expectTodayInTheHouse(page, asked);
  });
}

test('at 200% text on a phone /train and its form reflow, open, full, closed, refused by the form and sent', async ({
  page,
}) => {
  let status: object = openStatus();
  await asVisitor(page, () => status);
  await open(page, '/train');
  await bigText(page);
  await expect(page.getByRole('link', { name: 'Create your account' })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  for (const next of [FULL, CLOSED]) {
    status = next;
    await page.reload();
    await ready(page);
    await bigText(page);
    await expect(page.locator(next === FULL ? '[data-full]' : '[data-closed]')).toBeVisible();
    await expectNoHorizontalOverflow(page);
  }

  status = openStatus();
  await open(page, '/train/sign-up');
  await bigText(page);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.locator('#train-summary')).toContainText("Your account can't be created yet:");
  await expectNoHorizontalOverflow(page);
  await page.screenshot({
    path: test.info().outputPath('train-form-200-390.png'),
    fullPage: true,
  });

  await fillForm(page);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});
