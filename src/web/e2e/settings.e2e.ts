import AxeBuilder from '@axe-core/playwright';
import type { Page, Route } from '@playwright/test';
import {
  COACH_MEMBERSHIP,
  expect,
  expectNoHorizontalOverflow,
  json,
  mockSession,
  OWNER_MEMBERSHIP,
  SIGNED_IN_USER,
  test,
  waitForFonts,
} from './support';

/**
 * Settings (C9, R5.2a) in a real browser: one layout with the coaching space's pages and the
 * person's own, Name and region with its time zone sheet and leave warning, Team with faces and its
 * invite sheet, Billing with its invoice list and invoice sheet, and Password and security for staff
 * and clients. Every API call is a per-test mock; guards, interceptors and stores run unchanged.
 */
type Handler = (route: Route) => Promise<void> | void;

const DAY = 24 * 60 * 60 * 1000;
const inDays = (days: number) => new Date(Date.now() + days * DAY).toISOString();

const WORKSPACE = {
  id: OWNER_MEMBERSHIP.tenantId,
  name: 'Atlas Performance',
  slug: 'atlas-performance',
  timeZoneId: 'Asia/Beirut',
  defaultCulture: 'en-LB',
  defaultCurrencyCode: 'USD',
  weekStartsOn: 'Monday',
  currentDate: '2026-10-09',
  version: 4,
  brandColor: null,
  accentColor: null,
  logoAssetId: null,
};

const MEMBERS = [
  {
    userId: SIGNED_IN_USER.id,
    displayName: 'Hicham Haddad',
    email: 'coach@example.test',
    role: 'Owner',
    assignedClientCount: 9,
    joinedAtUtc: '2026-03-02T09:00:00Z',
    version: 3,
  },
  {
    userId: 'coach-lea',
    displayName: 'Lea Haddad',
    email: 'lea@atlas.example',
    role: 'Coach',
    assignedClientCount: 7,
    joinedAtUtc: '2026-04-14T09:00:00Z',
    version: 5,
  },
  {
    userId: 'coach-karim',
    displayName: 'Karim Mansour',
    email: 'karim@atlas.example',
    role: 'Coach',
    assignedClientCount: 4,
    joinedAtUtc: '2026-06-01T09:00:00Z',
    version: 2,
  },
];

const INVITATIONS = [
  {
    id: 'invite-nour',
    email: 'nour@atlas.example',
    firstName: 'Nour',
    lastName: 'Khoury',
    status: 'Pending',
    expiresAtUtc: inDays(5),
    sendCount: 1,
    logicalSendGeneration: 1,
    createdAtUtc: inDays(-2),
    version: 1,
    developmentActionUrl: null,
    kind: 'Coach',
  },
];

function amounts(total: number, overrides: Record<string, number> = {}) {
  return {
    seats: 3,
    billableClients: 20,
    includedClients: 15,
    extraClients: 5,
    seatAmount: 45,
    extraClientAmount: 10,
    gymFeeAmount: 0,
    subtotal: 55,
    discountPercent: 0,
    discountAmount: 0,
    total,
    currencyCode: 'USD',
    ...overrides,
  };
}

function invoice(id: string, month: string, status: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    referenceCode: `TBG-2026${month}-${id.toUpperCase().slice(-4)}`,
    periodStart: `2026-${month}-01`,
    periodEndExclusive: `2026-${String(Number(month) + 1).padStart(2, '0')}-01`,
    usageFromUtc: `2026-${month}-01T00:00:00Z`,
    issuedAtUtc: `2026-${String(Number(month) + 1).padStart(2, '0')}-01T00:10:00Z`,
    dueOn: `2026-${String(Number(month) + 1).padStart(2, '0')}-08`,
    readOnlyFrom: `2026-${String(Number(month) + 1).padStart(2, '0')}-15`,
    pricePlanVersion: 1,
    calculationName: 'platform-invoice-v1',
    planSeatPrice: 15,
    planIncludedClientsPerSeat: 5,
    planExtraClientPrice: 2,
    planGymFee: 0,
    planGymFeeMinimumSeats: 5,
    amounts: amounts(55),
    status,
    locksWorkspace: false,
    payment: null,
    voidedAtUtc: null,
    voidReason: null,
    replacesInvoiceId: null,
    replacedByInvoiceId: null,
    ...extra,
  };
}

const BILLING = {
  status: 'Active',
  trialEndsAtUtc: '2026-05-01T00:00:00Z',
  currentMonth: {
    periodStart: '2026-10-01',
    periodEndExclusive: '2026-11-01',
    usageFromUtc: '2026-10-01T00:00:00Z',
    usageToUtc: '2026-10-09T00:00:00Z',
    inTrial: false,
    pricePlanVersion: 1,
    amounts: amounts(44, {
      discountPercent: 20,
      discountAmount: 11,
      subtotal: 55,
    }),
  },
  invoices: [
    invoice('inv-sep', '09', 'Open'),
    invoice('inv-aug', '08', 'Paid', {
      payment: {
        id: 'pay-aug',
        amount: 55,
        currencyCode: 'USD',
        reference: 'WH-88213',
        note: null,
        receivedOn: '2026-09-03',
        recordedAtUtc: '2026-09-03T10:00:00Z',
      },
    }),
    invoice('inv-jul', '07', 'Paid', {
      payment: {
        id: 'pay-jul',
        amount: 55,
        currencyCode: 'USD',
        reference: 'WH-71540',
        note: null,
        receivedOn: '2026-08-04',
        recordedAtUtc: '2026-08-04T10:00:00Z',
      },
    }),
  ],
  unpaidTotal: 55,
  currencyCode: 'USD',
  readOnlyFrom: null,
  paymentInstructions: { whishNumber: '+961 70 123 456' },
};

const PREFERENCES = {
  inAppEnabled: true,
  emailServiceEnabled: true,
  emailChannelAvailable: true,
  emailSuppressed: false,
  emailSuppressionReason: null,
  quietHoursEnabled: false,
  quietHoursStartLocal: null,
  quietHoursEndLocal: null,
  tenantTimeZoneId: 'Asia/Beirut',
  version: 1,
};

async function open(
  page: Page,
  path: string,
  heading: string,
  options: {
    width?: number;
    dark?: boolean;
    memberships?: (typeof OWNER_MEMBERSHIP)[];
    extra?: Record<string, Handler>;
  } = {},
) {
  await page.emulateMedia({ colorScheme: options.dark ? 'dark' : 'light' });
  await page.setViewportSize({ width: options.width ?? 1440, height: 900 });
  const saves: unknown[] = [];
  await mockSession(page, {
    memberships: options.memberships,
    extra: {
      'GET /api/workspace': (route) => json(route, 200, WORKSPACE),
      'PUT /api/workspace': (route) => {
        const body = route.request().postDataJSON() as Record<string, unknown>;
        saves.push(body);
        return json(route, 200, { ...WORKSPACE, ...body, version: 5 });
      },
      'GET /api/team/members': (route) => json(route, 200, MEMBERS),
      'GET /api/team/invitations': (route) => json(route, 200, INVITATIONS),
      'GET /api/billing': (route) => json(route, 200, BILLING),
      'GET /api/notifications/preferences': (route) => json(route, 200, PREFERENCES),
      ...(options.extra ?? {}),
    },
  });
  await page.goto(path);
  await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible();
  await waitForFonts(page);
  return saves;
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

const PAGES = [
  { path: '/workspace', heading: 'Name and region', shot: 'space' },
  { path: '/team', heading: 'Team', shot: 'team' },
  { path: '/billing', heading: 'Billing', shot: 'billing' },
  { path: '/account/security', heading: 'Password and security', shot: 'security' },
];

for (const width of [390, 1440]) {
  for (const dark of [false, true]) {
    const mode = dark ? 'dark' : 'light';
    for (const target of PAGES) {
      test(`${target.heading} sits in the Settings layout at ${width}px, ${mode}, and passes axe`, async ({
        page,
      }) => {
        await open(page, target.path, target.heading, { width, dark });

        const nav = page.getByRole('navigation', { name: 'Settings' });
        await expect(nav.getByRole('link')).toHaveText([
          'Name and region',
          'Brand',
          'Nutrition',
          'Team',
          'Billing',
          'Notifications',
          'Appearance',
          'Password and security',
        ]);
        await expect(nav.getByRole('link', { name: target.heading })).toHaveAttribute(
          'aria-current',
          'page',
        );
        // The page follows the person's mode: nothing forces it light.
        await expect(page.locator('main')).not.toHaveAttribute('data-mode', 'light');
        await expectNoHorizontalOverflow(page);
        await axe(page);
        await page.screenshot({
          path: `test-results/r52a-${target.shot}-${width}-${mode}.png`,
          fullPage: true,
        });
      });
    }
  }

  test(`every Settings page reflows with 200% text at ${width}px`, async ({ page }) => {
    await open(page, '/workspace', 'Name and region', { width });
    await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
    for (const target of PAGES) {
      await page
        .getByRole('navigation', { name: 'Settings' })
        .getByRole('link', {
          name: target.heading,
        })
        .click();
      await expect(page.getByRole('heading', { name: target.heading, level: 1 })).toBeVisible();
      await expectNoHorizontalOverflow(page);
    }
  });
}

test('Name and region saves a new time zone, week start and currency', async ({ page }) => {
  const saves = await open(page, '/workspace', 'Name and region', { width: 390 });

  await expect(page.locator('[data-zone] strong')).toHaveText('Beirut, Asia');
  await page.getByRole('button', { name: 'Change', exact: true }).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByRole('heading', { name: 'Time zone' })).toBeVisible();
  await expect(sheet.getByLabel('Search by city')).toBeFocused();
  await axe(page);
  await page.screenshot({ path: 'test-results/r52a-space-zone-390.png' });
  await sheet.getByLabel('Search by city').fill('dubai');
  await sheet.getByRole('button', { name: /Dubai/ }).click();
  await expect(sheet).toHaveCount(0);
  await expect(page.locator('[data-zone] strong')).toHaveText('Dubai, Asia');

  await page.getByRole('radio', { name: 'Sunday' }).check();
  await page.getByRole('radio', { name: 'Another' }).check();
  await page.getByLabel('Currency code').fill('aed');
  await expect(page.locator('[data-currency-line]')).toContainText('(AED)');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Settings saved.')).toBeVisible();

  expect(saves).toEqual([
    {
      name: 'Atlas Performance',
      timeZoneId: 'Asia/Dubai',
      defaultCulture: 'en-LB',
      defaultCurrencyCode: 'AED',
      weekStartsOn: 'Sunday',
      version: 4,
    },
  ]);
  await expect(page.getByRole('button', { name: 'Save changes' })).toBeDisabled();
});

test('Name and region asks before its changes are left behind', async ({ page }) => {
  await open(page, '/workspace', 'Name and region');

  await page.getByLabel('Coaching space name').fill('Atlas Strength');
  await page
    .getByRole('navigation', { name: 'Settings' })
    .getByRole('link', { name: 'Team' })
    .click();
  const ask = page.getByRole('dialog');
  await expect(ask.getByRole('heading', { name: 'Leave without saving?' })).toBeVisible();
  await axe(page);
  await page.screenshot({ path: 'test-results/r52a-space-leave-1440.png' });
  await ask.getByRole('button', { name: 'Stay' }).click();
  await expect(page).toHaveURL(/\/workspace$/);
  await expect(page.getByLabel('Coaching space name')).toHaveValue('Atlas Strength');

  await page
    .getByRole('navigation', { name: 'Settings' })
    .getByRole('link', { name: 'Team' })
    .click();
  await page.getByRole('dialog').getByRole('button', { name: 'Leave without saving' }).click();
  await expect(page.getByRole('heading', { name: 'Team', level: 1 })).toBeVisible();
});

test('Team invites a coach from a sheet that passes axe', async ({ page }) => {
  const invites: unknown[] = [];
  await open(page, '/team', 'Team', {
    width: 390,
    extra: {
      'POST /api/team/invitations': (route) => {
        invites.push(route.request().postDataJSON());
        return json(route, 200, {
          ...INVITATIONS[0],
          id: 'invite-rami',
          email: 'rami@atlas.example',
          firstName: 'Rami',
          lastName: 'Saad',
          createdAtUtc: new Date().toISOString(),
        });
      },
    },
  });

  await expect(page.locator('[data-member] app-avatar')).toHaveText(['HH', 'KM', 'LH']);
  await page.getByRole('button', { name: 'Invite a coach' }).click();
  const sheet = page.getByRole('dialog');
  await sheet.getByRole('button', { name: 'Send invitation' }).click();
  await expect(sheet.getByText('Type the coach’s email address.')).toBeVisible();
  await expect(sheet.getByLabel('Email')).toBeFocused();
  await axe(page);
  await page.screenshot({ path: 'test-results/r52a-team-invite-390.png' });
  await sheet.getByLabel('Email').fill('rami@atlas.example');
  await sheet.getByLabel('First name').fill('Rami');
  await sheet.getByLabel('Last name').fill('Saad');
  await sheet.getByRole('button', { name: 'Send invitation' }).click();
  await expect(sheet).toHaveCount(0);
  await expect(page.locator('[data-invitation="invite-rami"]')).toBeVisible();
  expect(invites).toEqual([{ email: 'rami@atlas.example', firstName: 'Rami', lastName: 'Saad' }]);
});

test('Billing opens an invoice in a sheet with its lines and payment', async ({ page }) => {
  await open(page, '/billing', 'Billing', { width: 390 });

  await expect(page.locator('[data-unpaid]')).toHaveText(/To pay\s*\$55\.00/);
  await page.locator('[data-invoice="inv-aug"] button').click();
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByRole('heading', { name: 'August 2026 invoice' })).toBeVisible();
  await expect(sheet).toContainText('WH-88213');
  await expectNoHorizontalOverflow(page);
  await axe(page);
  await page.screenshot({ path: 'test-results/r52a-billing-invoice-390.png' });
});

test('a coach’s Settings are their own account’s pages, and Billing stays the owner’s', async ({
  page,
}) => {
  await open(page, '/account/security', 'Password and security', {
    memberships: [COACH_MEMBERSHIP],
  });

  const nav = page.getByRole('navigation', { name: 'Settings' });
  await expect(nav.getByRole('link')).toHaveText([
    'Notifications',
    'Appearance',
    'Password and security',
  ]);
  await expect(page.getByRole('heading', { name: 'Leave Beirut Barbell' })).toBeVisible();
  await page.getByRole('button', { name: 'Sign out everywhere' }).click();
  await expect(
    page.getByRole('dialog').getByRole('heading', { name: 'Sign out everywhere?' }),
  ).toBeVisible();
  await axe(page);
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
  await nav.getByRole('link', { name: 'Appearance' }).click();
  await expect(page.getByRole('heading', { name: 'Appearance', level: 1 })).toBeVisible();
  await axe(page);
  await nav.getByRole('link', { name: 'Notifications' }).click();
  await expect(
    page.getByRole('heading', { name: 'Notification settings', level: 1 }),
  ).toBeVisible();
  await axe(page);
});

test('a client opens Password and security from Me and goes back there', async ({ page }) => {
  const client = { ...OWNER_MEMBERSHIP, role: 'Client' };
  await open(page, '/account/security', 'Password and security', {
    width: 390,
    memberships: [client],
    extra: {
      // The client shell reads the client's plan access on every page.
      'GET /api/client-access/me': (route) =>
        json(route, 200, [{ feature: 'Training', isAllowed: true, reason: 'Granted' }]),
    },
  });

  await expect(page.getByRole('navigation', { name: 'Settings' })).toHaveCount(0);
  await expect(page.locator('a.back')).toHaveAttribute('href', '/me');
  await expectNoHorizontalOverflow(page);
  await axe(page);
  await page.screenshot({ path: 'test-results/r52a-security-client-390.png', fullPage: true });
});
