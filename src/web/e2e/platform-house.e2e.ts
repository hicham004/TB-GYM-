import AxeBuilder from '@axe-core/playwright';
import type { Locator, Page, Route } from '@playwright/test';
import {
  foundingTerms,
  gymRequests,
  platformSpaces,
  pricePlans,
} from '../src/testing/platform-admin-fixtures';
import {
  expect,
  expectNoHorizontalOverflow,
  json,
  mockSession,
  SIGNED_IN_USER,
  test,
  waitForFonts,
} from './support';

/**
 * The platform admin's House page (notes plan N9a2, ADR 0041) in a real browser: which coaching space is
 * TB Gym's own, where its sign-up stands this week, and its two settings, one changed in the sheet, once
 * straight and once over a change made meanwhile; the panel shown while no space is marked, the page when
 * the house cannot be read, and Browser Back asking before it drops a typed change. Every call
 * is a per-test mock answered in place by a small record that keeps versions as the server does, so a save
 * shows on the next read and a stale version is refused; guards, interceptors and stores run unchanged. The
 * house keeps Beirut's clock, so a change made just after its midnight reads on the house's day.
 */
const ADMIN = { ...SIGNED_IN_USER, displayName: 'Ziad Matar', roles: ['PlatformAdmin'] };
/** Thursday 12 November, 11:00 in Beirut. */
const NOW = '2026-11-12T09:00:00Z';
const HOUSE_ID = '00000000-0000-4000-8000-0000000000f1';
const HOUSE_NAME = 'TB Gym coaching space';

type Setting = 'SignUpsPerWeek' | 'MinimumSignUpAge' | 'FreeProgressDays' | 'MediaStorageGigabytes';

interface SettingView {
  readonly setting: Setting;
  readonly value: string | null;
  readonly version: number;
  readonly changedAtUtc: string | null;
  readonly changedByUserId: string | null;
  readonly changedByName: string | null;
}

const HOUSE_WORKSPACE = {
  tenantId: HOUSE_ID,
  name: HOUSE_NAME,
  slug: 'tb-gym-coaching-space',
  timeZoneId: 'Asia/Beirut',
  weekStartsOn: 'Monday',
  currentDate: '2026-11-12',
};

/**
 * 23 a week, set by Ziad on Tuesday morning; age 19, set at 00:30 on Tuesday in Beirut, while UTC was
 * still on Monday, by nobody named (the account that changed it is gone).
 */
function filledSettings(): SettingView[] {
  return [
    {
      setting: 'SignUpsPerWeek',
      value: '23',
      version: 3,
      changedAtUtc: '2026-11-10T08:30:00Z',
      changedByUserId: ADMIN.id,
      changedByName: ADMIN.displayName,
    },
    {
      setting: 'MinimumSignUpAge',
      value: '19',
      version: 1,
      changedAtUtc: '2026-11-09T22:30:00Z',
      changedByUserId: null,
      changedByName: null,
    },
  ];
}

/** Each setting as a house newly marked has it: empty, never set. */
function emptySettings(): SettingView[] {
  return (['SignUpsPerWeek', 'MinimumSignUpAge'] as const).map((setting) => ({
    setting,
    value: null,
    version: 0,
    changedAtUtc: null,
    changedByUserId: null,
    changedByName: null,
  }));
}

/** The house's week from Monday 9 to Sunday 15 November: 7 places taken, 3 waiting. */
function week(status: 'Open' | 'Full' | 'Closed' = 'Open') {
  return {
    status,
    weekStartsOn: '2026-11-09',
    weekEndsOnExclusive: '2026-11-16',
    signUpsThisWeek: status === 'Closed' ? 0 : 7,
    waitingForConfirmation: status === 'Closed' ? 0 : 3,
  };
}

/** The house as the server keeps it for one test, answering `/api/platform-admin/house` and its PUTs. */
class HouseRecord {
  readonly puts: { setting: string; body: unknown }[] = [];
  house: typeof HOUSE_WORKSPACE | null;
  settings: SettingView[];
  signUp: ReturnType<typeof week> | null;
  /** While true, reading the house fails as a server fault would. */
  failing = false;

  constructor(
    options: {
      house?: typeof HOUSE_WORKSPACE | null;
      settings?: SettingView[];
      signUp?: ReturnType<typeof week> | null;
    } = {},
  ) {
    this.house = options.house === undefined ? HOUSE_WORKSPACE : options.house;
    this.settings = options.settings ?? filledSettings();
    this.signUp = options.signUp === undefined ? week() : options.signUp;
  }

  /** Another admin saves a setting while the sheet is open. */
  changeElsewhere(setting: Setting, value: string | null, name: string): void {
    this.settings = this.settings.map((row) =>
      row.setting === setting
        ? {
            ...row,
            value,
            version: row.version + 1,
            changedAtUtc: '2026-11-12T08:50:00Z',
            changedByUserId: '00000000-0000-4000-8000-0000000000d4',
            changedByName: name,
          }
        : row,
    );
  }

  async answer(route: Route): Promise<void> {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === 'GET' && path === '/api/platform-admin/house') {
      if (this.failing) {
        return json(route, 500, {
          title: 'An error occurred while processing your request.',
          status: 500,
        });
      }
      return json(route, 200, {
        house: this.house,
        settings: this.house ? this.settings : [],
        signUp: this.house ? this.signUp : null,
      });
    }
    const change = /^\/api\/platform-admin\/house\/settings\/([^/]+)$/.exec(path);
    if (request.method() !== 'PUT' || !change) {
      return json(route, 404, { title: 'Not Found', status: 404 });
    }
    const body = request.postDataJSON() as { value: string | null; expectedVersion: number };
    this.puts.push({ setting: change[1], body });
    if (this.house === null) {
      return json(route, 409, {
        code: 'house_not_set',
        message: 'No coaching space is marked as the house yet, so it has no settings to change.',
      });
    }
    const row = this.settings.find((item) => item.setting === change[1]);
    if (!row) return json(route, 404, { title: 'Not Found', status: 404 });
    if (Number(body.expectedVersion) !== row.version) {
      return json(route, 409, {
        code: 'house_setting_changed',
        message: 'This setting changed since the page loaded. Refresh and try again.',
      });
    }
    const saved: SettingView = {
      ...row,
      value: body.value,
      version: row.version + 1,
      changedAtUtc: NOW,
      changedByUserId: ADMIN.id,
      changedByName: ADMIN.displayName,
    };
    this.settings = this.settings.map((item) => (item.setting === saved.setting ? saved : item));
    return json(route, 200, saved);
  }
}

async function openHouse(
  page: Page,
  width: number,
  options: { dark?: boolean; record?: HouseRecord; path?: string } = {},
): Promise<HouseRecord> {
  const record = options.record ?? new HouseRecord();
  await page.clock.setFixedTime(new Date(NOW));
  await page.emulateMedia({ colorScheme: options.dark ? 'dark' : 'light' });
  await page.setViewportSize({ width, height: width < 600 ? 844 : 900 });
  await mockSession(page, {
    user: ADMIN,
    extra: {
      // Platform billing, which the page is reached from and leads back to.
      'GET /api/platform-admin/workspaces': (route) => json(route, 200, platformSpaces()),
      'GET /api/platform-admin/price-plans': (route) => json(route, 200, pricePlans()),
      'GET /api/platform-admin/contact-requests': (route) => json(route, 200, gymRequests()),
      'GET /api/platform-admin/founding-terms': (route) => json(route, 200, [foundingTerms()]),
    },
  });
  // Registered after the session's mocks, so it is asked first.
  await page.route(
    (url) => url.pathname.startsWith('/api/platform-admin/house'),
    (route) => record.answer(route),
  );
  await page.goto(options.path ?? '/admin/house');
  await waitForFonts(page);
  return record;
}

async function axe(page: Page): Promise<void> {
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

/** In the person's dark mode, not kept light: the page is rebuilt on brand v2. */
async function expectDark(page: Page): Promise<void> {
  const mode = await page.evaluate(() => {
    const main = document.querySelector('main')!;
    return {
      forced: main.getAttribute('data-mode'),
      background: getComputedStyle(main).getPropertyValue('--tb-bg').trim(),
    };
  });
  expect(mode).toEqual({ forced: null, background: '#0f1513' });
}

const heading = (page: Page) => page.getByRole('heading', { name: 'House', level: 1 });
const settingRow = (page: Page, setting: Setting) => page.locator(`li[data-setting="${setting}"]`);
const sheetOf = (page: Page) =>
  page.getByRole('dialog', { name: 'Change new sign-ups a week', exact: true });
const box = (sheet: Locator) => sheet.getByLabel('New sign-ups a week');

for (const width of [390, 1440]) {
  for (const dark of [false, true]) {
    const named = `${width}px${dark ? ' in dark mode' : ''}`;
    const mode = dark ? '-dark' : '';

    test(`the House page at ${named} shows the house, this week’s sign-up and its settings, and a change saved in the sheet is sent at the version read`, async ({
      page,
    }) => {
      const record = await openHouse(page, width, { dark });
      await expect(page).toHaveTitle('House | TB Gym');
      await expect(heading(page)).toBeFocused();

      const house = page.locator('[data-house]');
      await expect(house.getByRole('link', { name: HOUSE_NAME })).toHaveAttribute(
        'href',
        `/admin/billing/${HOUSE_ID}`,
      );
      await expect(house.locator('dt')).toHaveText(['Coaching space', 'Clock', 'Week starts on']);
      await expect(house.locator('dd')).toHaveText([HOUSE_NAME, 'Beirut, Asia', 'Monday']);

      const signUp = page.locator('[data-sign-up]');
      await expect(signUp.locator('.panel-head .quiet')).toHaveText('Mon 9 Nov – Sun 15 Nov');
      await expect(signUp.locator('app-status-pill')).toHaveText('Open');
      await expect(signUp.locator('[data-sign-up-line]')).toHaveText(
        'People can sign up on the Train with TB Gym page now.',
      );
      await expect(signUp.locator('app-stat-tile .value')).toHaveText(['7', '3']);
      await expect(signUp.locator('app-stat-tile .context')).toHaveText([
        'of 23 this week',
        'Email not confirmed yet, or confirmed into a full week',
      ]);

      const perWeek = settingRow(page, 'SignUpsPerWeek');
      const age = settingRow(page, 'MinimumSignUpAge');
      await expect(perWeek.locator('strong')).toHaveText('New sign-ups a week');
      await expect(perWeek.locator('[data-value]')).toHaveText('23');
      await expect(perWeek.locator('[data-changed]')).toHaveText(
        'Changed by Ziad Matar on Tue 10 Nov',
      );
      await expect(age.locator('strong')).toHaveText('Youngest age that may sign up');
      await expect(age.locator('[data-value]')).toHaveText('19');
      // On the house's clock: 22:30 UTC on Monday is Tuesday in Beirut.
      await expect(age.locator('[data-changed]')).toHaveText('Changed on Tue 10 Nov');
      await expect(page.locator('[data-no-house]')).toHaveCount(0);
      if (dark) await expectDark(page);
      await expectNoHorizontalOverflow(page);
      await axe(page);
      await page.screenshot({
        path: test.info().outputPath(`n9a2-house-${width}${mode}.png`),
        fullPage: true,
      });

      await perWeek.getByRole('button', { name: 'Change new sign-ups a week' }).click();
      const sheet = sheetOf(page);
      await expect(sheet.locator('[data-in-force]')).toHaveText(
        'In force now: 23 · Changed by Ziad Matar on Tue 10 Nov',
      );
      await expect(box(sheet)).toHaveValue('23');
      await box(sheet).fill('31');
      await expectNoHorizontalOverflow(page);
      await axe(page);
      await page.screenshot({
        path: test.info().outputPath(`n9a2-house-sheet-${width}${mode}.png`),
      });
      await sheet.getByRole('button', { name: 'Save' }).click();

      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(page.getByText('New sign-ups a week is now 31.')).toBeVisible();
      expect(record.puts).toEqual([
        { setting: 'SignUpsPerWeek', body: { value: '31', expectedVersion: 3 } },
      ]);
      // The page reads the house again: the value, who changed it and the places it allows.
      await expect(perWeek.locator('[data-value]')).toHaveText('31');
      await expect(perWeek.locator('[data-changed]')).toHaveText(
        'Changed by Ziad Matar on Thu 12 Nov',
      );
      await expect(signUp.locator('app-stat-tile .context').first()).toHaveText('of 31 this week');
      await expect(age.locator('[data-value]')).toHaveText('19');
    });
  }
}

test.describe('a change made meanwhile', () => {
  // The refusal logs its failed request, which is the point of it.
  test.use({ allowedConsoleErrors: { patterns: [/status of 409/] } });

  for (const width of [390, 1440]) {
    test(`is answered at ${width}px: the line above shows the setting as it is now, what was typed stays, and Save replaces it`, async ({
      page,
    }) => {
      const record = await openHouse(page, width);
      const perWeek = settingRow(page, 'SignUpsPerWeek');
      await perWeek.getByRole('button', { name: 'Change new sign-ups a week' }).click();
      const sheet = sheetOf(page);
      await box(sheet).fill('31');
      record.changeElsewhere('SignUpsPerWeek', '29', 'Lina Saad');
      await sheet.getByRole('button', { name: 'Save' }).click();

      await expect(sheet.getByRole('alert')).toHaveText(
        'This setting was changed while this sheet was open. The line above shows it as it is now; save again to replace it.',
      );
      await expect(sheet.locator('[data-in-force]')).toHaveText(
        'In force now: 29 · Changed by Lina Saad on Thu 12 Nov',
      );
      await expect(box(sheet)).toHaveValue('31');
      await expect(page.getByRole('dialog')).toHaveCount(1);
      // Behind the sheet the page was read again too.
      await expect(perWeek.locator('[data-value]')).toHaveText('29');
      await expectNoHorizontalOverflow(page);
      await axe(page);
      await page.screenshot({ path: test.info().outputPath(`n9a2-house-changed-${width}.png`) });

      await sheet.getByRole('button', { name: 'Save' }).click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(page.getByText('New sign-ups a week is now 31.')).toBeVisible();
      expect(record.puts.map((put) => put.body)).toEqual([
        { value: '31', expectedVersion: 3 },
        { value: '31', expectedVersion: 4 },
      ]);
      await expect(perWeek.locator('[data-value]')).toHaveText('31');
      await expect(perWeek.locator('[data-changed]')).toHaveText(
        'Changed by Ziad Matar on Thu 12 Nov',
      );
    });
  }
});

for (const width of [390, 1440]) {
  test(`with no coaching space marked as the house at ${width}px, the page names the command that marks one and offers no setting`, async ({
    page,
  }) => {
    await openHouse(page, width, { record: new HouseRecord({ house: null, settings: [] }) });
    await expect(heading(page)).toBeFocused();

    const panel = page.locator('[data-no-house]');
    await expect(panel.getByRole('heading', { level: 2 })).toHaveText(
      'No coaching space is marked as the house',
    );
    await expect(panel).toContainText(
      'Sign-up stays closed until one is. Mark one on the server with this command; its settings then appear here, each empty.',
    );
    await expect(panel.locator('code.command')).toHaveText('platform-admin house set <slug or id>');
    await expect(page.locator('[data-house], [data-sign-up], [data-settings]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Change/ })).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
    await axe(page);
    await page.screenshot({ path: test.info().outputPath(`n9a2-no-house-${width}.png`) });
  });
}

test.describe('when the house cannot be read', () => {
  // The failed read logs its request, which is the point of it.
  test.use({
    allowedConsoleErrors: { patterns: [/status of 500 .*\/api\/platform-admin\/house/] },
  });

  for (const width of [390, 1440]) {
    test(`the page says so at ${width}px with Try again, which reads the house again`, async ({
      page,
    }) => {
      const record = new HouseRecord();
      record.failing = true;
      await openHouse(page, width, { record });
      await expect(heading(page)).toBeFocused();

      const failed = page.locator('.load-failed');
      await expect(failed.getByRole('alert')).toHaveText('The house couldn’t be loaded.');
      await expect(failed.getByRole('button', { name: 'Try again' })).toBeVisible();
      await expect(
        page.locator('[data-house], [data-sign-up], [data-settings], [data-no-house]'),
      ).toHaveCount(0);
      await expectNoHorizontalOverflow(page);
      await axe(page);
      await page.screenshot({ path: test.info().outputPath(`n9a2-house-failed-${width}.png`) });

      record.failing = false;
      await failed.getByRole('button', { name: 'Try again' }).click();
      await expect(settingRow(page, 'SignUpsPerWeek').locator('[data-value]')).toHaveText('23');
      await expect(page.locator('.load-failed')).toHaveCount(0);
    });
  }
});

test('a house newly marked reads each setting Empty and Never set with sign-up closed, and filling one sends it at version 0', async ({
  page,
}) => {
  const record = await openHouse(page, 1440, {
    record: new HouseRecord({ settings: emptySettings(), signUp: week('Closed') }),
  });
  const signUp = page.locator('[data-sign-up]');
  await expect(signUp.locator('app-status-pill')).toHaveText('Closed');
  await expect(signUp.locator('[data-sign-up-line]')).toHaveText(
    'Sign-up opens once new sign-ups a week is above 0 and the youngest age is filled.',
  );
  await expect(signUp.locator('app-stat-tile .context').first()).toHaveText('this week');
  for (const setting of ['SignUpsPerWeek', 'MinimumSignUpAge'] as const) {
    await expect(settingRow(page, setting).locator('[data-value]')).toHaveText('Empty');
    await expect(settingRow(page, setting).locator('[data-changed]')).toHaveText('Never set');
  }
  await axe(page);

  const age = settingRow(page, 'MinimumSignUpAge');
  await age.getByRole('button', { name: 'Change the youngest age that may sign up' }).click();
  const sheet = page.getByRole('dialog', {
    name: 'Change the youngest age that may sign up',
    exact: true,
  });
  await expect(sheet.locator('[data-in-force]')).toHaveText('In force now: Empty · Never set');
  await expect(sheet.getByLabel('Youngest age that may sign up')).toHaveValue('');
  await sheet.getByLabel('Youngest age that may sign up').fill('19');
  await sheet.getByRole('button', { name: 'Save' }).click();

  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('Youngest age that may sign up is now 19.')).toBeVisible();
  expect(record.puts).toEqual([
    { setting: 'MinimumSignUpAge', body: { value: '19', expectedVersion: 0 } },
  ]);
  await expect(age.locator('[data-value]')).toHaveText('19');
  await expect(age.locator('[data-changed]')).toHaveText('Changed by Ziad Matar on Thu 12 Nov');
});

test('emptying a setting sends no value, and the toast says sign-up is closed', async ({
  page,
}) => {
  const record = await openHouse(page, 390);
  const perWeek = settingRow(page, 'SignUpsPerWeek');
  await perWeek.getByRole('button', { name: 'Change new sign-ups a week' }).click();
  const sheet = sheetOf(page);
  await box(sheet).fill('');
  await sheet.getByRole('button', { name: 'Save' }).click();

  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(
    page.getByText('New sign-ups a week is now empty, so sign-up is closed.'),
  ).toBeVisible();
  expect(record.puts).toEqual([
    { setting: 'SignUpsPerWeek', body: { value: null, expectedVersion: 3 } },
  ]);
  await expect(perWeek.locator('[data-value]')).toHaveText('Empty');
});

/** Every setting the house has since notes plan N9b5: sign-up's two, Free's window and the house's storage. */
function allSettings(): SettingView[] {
  return [
    ...filledSettings(),
    {
      setting: 'FreeProgressDays',
      value: '90',
      version: 2,
      changedAtUtc: '2026-11-10T08:30:00Z',
      changedByUserId: ADMIN.id,
      changedByName: ADMIN.displayName,
    },
    {
      setting: 'MediaStorageGigabytes',
      value: '50',
      version: 1,
      changedAtUtc: '2026-11-10T08:30:00Z',
      changedByUserId: ADMIN.id,
      changedByName: ADMIN.displayName,
    },
  ];
}

for (const width of [390, 1440]) {
  test(`Free’s window and the house’s storage read with their units at ${width}px, and emptying the window lifts the limit (N9b5)`, async ({
    page,
  }) => {
    const record = await openHouse(page, width, {
      record: new HouseRecord({ settings: allSettings() }),
    });
    const window = settingRow(page, 'FreeProgressDays');
    const storage = settingRow(page, 'MediaStorageGigabytes');
    await expect(window.locator('strong')).toHaveText('How far back Free’s Progress reaches');
    await expect(window.locator('[data-value]')).toHaveText('90 days');
    await expect(storage.locator('strong')).toHaveText('The house’s media storage');
    await expect(storage.locator('[data-value]')).toHaveText('50 GB');
    await axe(page);
    await expectNoHorizontalOverflow(page);

    await window
      .getByRole('button', { name: 'Change how far back Free’s Progress reaches' })
      .click();
    const windowSheet = () =>
      page.getByRole('dialog', {
        name: 'Change how far back Free’s Progress reaches',
        exact: true,
      });
    const sheet = windowSheet();
    await sheet.getByLabel('How far back Free’s Progress reaches').fill('30');
    await sheet.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(
      page.getByText('How far back Free’s Progress reaches is now 30 days.'),
    ).toBeVisible();
    await expect(window.locator('[data-value]')).toHaveText('30 days');

    await window
      .getByRole('button', { name: 'Change how far back Free’s Progress reaches' })
      .click();
    await windowSheet().getByLabel('How far back Free’s Progress reaches').fill('');
    await windowSheet().getByRole('button', { name: 'Save' }).click();
    await expect(
      page.getByText(
        'How far back Free’s Progress reaches is now empty, so Free’s Progress has no limit.',
      ),
    ).toBeVisible();
    await expect(window.locator('[data-value]')).toHaveText('Empty');
    expect(record.puts).toEqual([
      { setting: 'FreeProgressDays', body: { value: '30', expectedVersion: 2 } },
      { setting: 'FreeProgressDays', body: { value: null, expectedVersion: 3 } },
    ]);
  });
}

test('Platform billing’s House link opens the page, and its own link leads back', async ({
  page,
}) => {
  await openHouse(page, 1440, { path: '/admin/billing' });
  await expect(page.getByRole('heading', { name: 'Platform billing', level: 1 })).toBeVisible();
  const links = page.locator('.top-actions a');
  await expect(links).toHaveText(['Legal documents', 'Coaches', 'House']);
  await page.locator('.top-actions').getByRole('link', { name: 'House', exact: true }).click();

  await expect(page).toHaveURL('/admin/house');
  await expect(heading(page)).toBeFocused();
  await expect(settingRow(page, 'SignUpsPerWeek').locator('[data-value]')).toHaveText('23');
  await page.locator('a[data-back]').click();
  await expect(page).toHaveURL('/admin/billing');
  await expect(page.getByRole('heading', { name: 'Platform billing', level: 1 })).toBeVisible();
});

test('Browser Back with a number typed in the sheet asks Discard this change? first, and Keep editing keeps it', async ({
  page,
}) => {
  const record = await openHouse(page, 1440, { path: '/admin/billing' });
  // Reached by a link: Back from a page opened by its address leaves the app, past the router's guard.
  await page.locator('.top-actions').getByRole('link', { name: 'House', exact: true }).click();
  await expect(heading(page)).toBeFocused();
  await settingRow(page, 'SignUpsPerWeek')
    .getByRole('button', { name: 'Change new sign-ups a week' })
    .click();
  const sheet = sheetOf(page);
  await box(sheet).fill('31');

  await page.goBack();
  const question = page.getByRole('dialog', { name: 'Discard this change?' });
  await expect(question).toContainText('Close without saving? What you typed will be lost.');
  await expect(question.getByRole('button', { name: 'Discard', exact: true })).toBeVisible();
  await question.getByRole('button', { name: 'Keep editing' }).click();

  await expect(question).toHaveCount(0);
  await expect(page).toHaveURL('/admin/house');
  await expect(sheet).toBeVisible();
  await expect(box(sheet)).toHaveValue('31');
  expect(record.puts).toEqual([]);
});

test('the page and its sheet reflow at 200% text on a phone', async ({ page }) => {
  await openHouse(page, 390);
  await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
  await expect(settingRow(page, 'MinimumSignUpAge').locator('[data-value]')).toHaveText('19');
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: test.info().outputPath('n9a2-house-200.png'), fullPage: true });

  await settingRow(page, 'SignUpsPerWeek')
    .getByRole('button', { name: 'Change new sign-ups a week' })
    .click();
  await expect(sheetOf(page).locator('[data-in-force]')).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: test.info().outputPath('n9a2-house-sheet-200.png') });
});
