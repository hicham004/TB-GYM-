import AxeBuilder from '@axe-core/playwright';
import type { Page, Route } from '@playwright/test';
import {
  COACH_MEMBERSHIP,
  expect,
  expectNoHorizontalOverflow,
  json,
  mockSession,
  NO_WEBSITE_SETTINGS,
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
    // Where the included clients came from (notes plan N11a): the seats' alone, a plain space.
    seatIncludedClients: 15,
    foundingIncludedClients: 0,
    grantedIncludedClients: 0,
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
    foundingSeatIncludedClients: null,
    foundingTermsVersion: null,
    grantedIncludedClients: 0,
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
    foundingTermsVersion: null,
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
  // N7: October's 20% runs on into a lower rate; the figures are this test's own.
  discounts: [
    {
      name: 'Early coach offer',
      percent: 20,
      startsOn: '2026-09-01',
      lastDay: '2026-10-31',
      endsOnExclusive: '2026-11-01',
      startsLater: false,
    },
    {
      name: 'Early coach offer',
      percent: 10,
      startsOn: '2026-11-01',
      lastDay: '2027-01-31',
      endsOnExclusive: '2027-02-01',
      startsLater: true,
    },
  ],
  // A plain space: not founding, no extra clients (notes plan N11b adds nothing to its page).
  foundingSeatIncludedClients: null,
  includedClientGrants: [],
};

/**
 * A founding space's bill (notes plan N11b): its owner's seat includes 13 clients, a grant of 4 more
 * runs until October's end and one of 7 more comes from December, and September's invoice counted
 * the founding seat and a grant. The figures are this test's own, never the owners' offer.
 */
const FOUNDING_BILLING = {
  ...BILLING,
  invoices: [
    invoice('inv-sep', '09', 'Open', {
      calculationName: 'platform-invoice-v2',
      foundingSeatIncludedClients: 13,
      foundingTermsVersion: 2,
      grantedIncludedClients: 4,
      amounts: amounts(55, {
        billableClients: 28,
        includedClients: 27,
        extraClients: 1,
        extraClientAmount: 2,
        seatIncludedClients: 15,
        foundingIncludedClients: 8,
        grantedIncludedClients: 4,
        subtotal: 47,
        total: 47,
      }),
    }),
    ...BILLING.invoices.slice(1),
  ],
  unpaidTotal: 47,
  foundingSeatIncludedClients: 13,
  includedClientGrants: [
    {
      clients: 4,
      startsOn: '2026-08-01',
      lastDay: '2026-10-31',
      endsOnExclusive: '2026-11-01',
      startsLater: false,
    },
    {
      clients: 7,
      startsOn: '2026-12-01',
      lastDay: '2027-02-28',
      endsOnExclusive: '2027-03-01',
      startsLater: true,
    },
  ],
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

// Team is the owner's own sidebar page since critique B3a, out of the Settings layout.
const PAGES = [
  { path: '/workspace', heading: 'Name and region', shot: 'space' },
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
          'Billing',
          'Undelivered notices',
          'Notifications',
          'Appearance',
          'Password and security',
          'Certificates',
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
    .getByRole('link', { name: 'Billing' })
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
    .getByRole('link', { name: 'Billing' })
    .click();
  await page.getByRole('dialog').getByRole('button', { name: 'Leave without saving' }).click();
  await expect(page.getByRole('heading', { name: 'Billing', level: 1 })).toBeVisible();
});

// Notes plan N2: the account menu's link to the website is a navigation like any other, so typed
// work is asked about before the page is left for /about.
for (const width of [1440, 390]) {
  test(`Name and region asks before the account menu’s TB Gym website link leaves its changes behind at ${width}px`, async ({
    page,
  }) => {
    await open(page, '/workspace', 'Name and region', {
      width,
      extra: {
        // What the homepage reads at /about.
        'GET /api/website/settings': (route) => json(route, 200, NO_WEBSITE_SETTINGS),
        'GET /api/website/contact-form': (route) => json(route, 200, { stamp: 'e2e-stamp' }),
      },
    });
    const name = page.getByLabel('Coaching space name');
    const account = page.locator('.account-button');
    const menu = page.locator('#account-menu');
    const ask = page.getByRole('dialog');

    await name.fill('Atlas Strength');
    await account.click();
    await menu.getByRole('link', { name: 'TB Gym website' }).click();
    await expect(ask.getByRole('heading', { name: 'Leave without saving?' })).toBeVisible();
    // Nothing has moved yet: the page and the shell around it are still there, the menu is closed.
    await expect(page).toHaveURL(/\/workspace$/);
    await expect(page.locator('app-coach-shell')).toBeVisible();
    await expect(page.locator('header.topbar')).toBeVisible();
    await expect(menu).toHaveCount(0);
    await axe(page);
    await page.screenshot({ path: `test-results/n2-space-leave-for-website-${width}.png` });

    await ask.getByRole('button', { name: 'Stay' }).click();
    await expect(ask).toHaveCount(0);
    await expect(page).toHaveURL(/\/workspace$/);
    await expect(page.getByRole('heading', { name: 'Name and region', level: 1 })).toBeVisible();
    await expect(name).toHaveValue('Atlas Strength');
    await expect(page.getByRole('button', { name: 'Save changes' })).toBeEnabled();
    await expect(menu).toHaveCount(0);
    await expect(account).toHaveAttribute('aria-expanded', 'false');
    await expect(account).toBeFocused();
    await expect(page.locator('app-coach-shell')).toBeVisible();
    await expect(page.locator('app-home-header')).toHaveCount(0);

    await account.click();
    await menu.getByRole('link', { name: 'TB Gym website' }).click();
    await ask.getByRole('button', { name: 'Leave without saving' }).click();
    await expect(page).toHaveURL(/\/about$/);
    await expect(page.getByRole('heading', { level: 1, name: /Coach both/ })).toBeVisible();
    await expect(page.locator('app-coach-shell')).toHaveCount(0);
    await expect(page.locator('.topbar')).toHaveCount(0);
    await expect(ask).toHaveCount(0);
  });
}

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
  // N7: the discount's name and its days, as the server sent them, in UTC days in every zone.
  await expect(page.locator('[data-billing-status] [data-discount]')).toHaveText(
    'Early coach offer: 20% off until Oct 31, 2026, then 10% off until Jan 31, 2027, then the normal price.',
  );
  await page.locator('[data-invoice="inv-aug"] button').click();
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByRole('heading', { name: 'August 2026 invoice' })).toBeVisible();
  await expect(sheet).toContainText('WH-88213');
  await expectNoHorizontalOverflow(page);
  await axe(page);
  await page.screenshot({ path: 'test-results/r52a-billing-invoice-390.png' });
});

for (const width of [390, 1440]) {
  for (const dark of [false, true]) {
    const mode = dark ? 'dark' : 'light';
    test(`a founding space’s Billing says what its seat includes and each grant until when, at ${width}px, ${mode}`, async ({
      page,
    }) => {
      await open(page, '/billing', 'Billing', {
        width,
        dark,
        extra: { 'GET /api/billing': (route) => json(route, 200, FOUNDING_BILLING) },
      });

      // After the discount line, one sentence for the founding seat and one per grant, in UTC days.
      await expect(page.locator('[data-billing-status] .sentence')).toHaveText([
        /^A new invoice is waiting\./,
        'Early coach offer: 20% off until Oct 31, 2026, then 10% off until Jan 31, 2027, then the normal price.',
        'As a founding coaching space, your own seat includes 13 clients.',
        '4 more clients included until Oct 31, 2026.',
        '7 more clients included from Dec 1, 2026 until Feb 28, 2027.',
      ]);
      await expectNoHorizontalOverflow(page);
      await axe(page);
      await page.screenshot({
        path: `test-results/n11b-billing-founding-${width}-${mode}.png`,
        fullPage: true,
      });

      // The invoice says where its included clients came from.
      await page.locator('[data-invoice="inv-sep"] button').click();
      const sheet = page.getByRole('dialog');
      await expect(sheet.getByRole('heading', { name: 'September 2026 invoice' })).toBeVisible();
      await expect(sheet.locator('.lines > div').nth(1)).toHaveText(
        /Clients with a plan: 28, 27 included: 15 with your seats, 8 more as a founding space, 4 more granted, 1 more × \$2\.00\s*\$2\.00/,
      );
      await expectNoHorizontalOverflow(page);
      await axe(page);
      await page.screenshot({ path: `test-results/n11b-billing-invoice-${width}-${mode}.png` });
    });
  }

  test(`a founding space’s Billing reads with 200% text at ${width}px`, async ({ page }) => {
    await open(page, '/billing', 'Billing', {
      width,
      extra: { 'GET /api/billing': (route) => json(route, 200, FOUNDING_BILLING) },
    });
    await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
    await expect(page.locator('[data-included-clients]')).toHaveCount(3);
    await expectNoHorizontalOverflow(page);
    await page.locator('[data-included-clients]').first().scrollIntoViewIfNeeded();
    await page.screenshot({ path: `test-results/n11b-billing-founding-200-${width}.png` });
  });
}

test('a plain space’s Billing says nothing of included clients', async ({ page }) => {
  await open(page, '/billing', 'Billing', { width: 390 });

  await expect(page.locator('[data-billing-status] [data-discount]')).toHaveCount(1);
  await expect(page.locator('[data-included-clients]')).toHaveCount(0);
});

test('a coach’s Settings are their own account’s pages, and Billing stays the owner’s', async ({
  page,
}) => {
  await open(page, '/account/security', 'Password and security', {
    memberships: [COACH_MEMBERSHIP],
  });

  const nav = page.getByRole('navigation', { name: 'Settings' });
  // The read-only Team a coach opens from here comes after their own pages (critique B3a), their
  // certificate lines among them (notes plan N4b).
  await expect(nav.getByRole('link')).toHaveText([
    'Notifications',
    'Appearance',
    'Password and security',
    'Certificates',
    'Team',
  ]);
  // The sidebar's Settings opens on the coach's own pages and stays selected on each (C13).
  const sidebarSettings = page.locator('.sidebar a.item[data-destination="settings"]');
  await expect(sidebarSettings).toHaveAttribute('href', '/notifications/settings');
  await expect(sidebarSettings).toHaveAttribute('aria-current', 'true');
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
  await expect(sidebarSettings).toHaveAttribute('aria-current', 'page');
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

// ---------- Settings › Founding coach (notes plan N3b) ----------

// Certificates is every owner's and coach's own (notes plan N4b); Founding coach stays last.
const OWNER_LINKS = [
  'Name and region',
  'Brand',
  'Nutrition',
  'Billing',
  'Undelivered notices',
  'Notifications',
  'Appearance',
  'Password and security',
  'Certificates',
];

const EARNED = {
  state: 'Earned',
  foundingSince: '2026-09-15',
  clientsWithActivePlan: null,
  clientsNeeded: 10,
  monthsSinceStart: null,
  monthsNeeded: 2,
  termsVersion: 1,
  earnedOn: '2026-10-03',
  endedOn: null,
  hidden: false,
};

// Under version 2's terms, so the page can only show numbers the server sent.
const WAITING = {
  ...EARNED,
  state: 'Waiting',
  clientsWithActivePlan: 5,
  clientsNeeded: 12,
  monthsSinceStart: 1,
  monthsNeeded: 3,
  termsVersion: 2,
  earnedOn: null,
};

/** The owner's founding reads, answered as N3a's API does, with the switch saved in place. */
function foundingApi(badge: typeof EARNED, saves: unknown[] = [], order: string[] = []) {
  let current = badge;
  return {
    'GET /api/billing/access': (route: Route) =>
      json(route, 200, {
        isReadOnly: false,
        hasOverdueInvoice: false,
        readOnlyFrom: null,
        foundingCoach:
          current.state === 'Waiting' || current.state === 'Earned' ? current.state : null,
      }),
    'GET /api/billing/founding': (route: Route) => json(route, 200, current),
    'PUT /api/billing/founding/visibility': (route: Route) => {
      const body = route.request().postDataJSON() as { hidden: boolean };
      saves.push(body);
      order.push('save');
      current = { ...current, hidden: body.hidden };
      return json(route, 200, current);
    },
  } satisfies Record<string, Handler>;
}

const showBadge = (page: Page) =>
  page.getByRole('checkbox', { name: 'Show the badge to your clients' });

for (const width of [390, 1440]) {
  for (const dark of [false, true]) {
    const mode = dark ? 'dark' : 'light';

    test(`the Founding coach page shows an earned badge at ${width}px, ${mode}, and passes axe`, async ({
      page,
    }) => {
      await open(page, '/account/founding', 'Founding coach', {
        width,
        dark,
        extra: foundingApi(EARNED),
      });

      const nav = page.getByRole('navigation', { name: 'Settings' });
      await expect(nav.getByRole('link')).toHaveText([...OWNER_LINKS, 'Founding coach']);
      await expect(nav.getByRole('link', { name: 'Founding coach' })).toHaveAttribute(
        'aria-current',
        'page',
      );
      const earned = page.locator('[data-founding-earned]');
      await expect(earned.locator('app-status-pill')).toHaveText('Founding coach');
      await expect(earned.locator('.line')).toHaveText(
        'One of the first coaches on TB Gym. Not a check of qualifications',
      );
      await expect(earned).toContainText('Earned Oct 3, 2026');
      await expect(showBadge(page)).toBeChecked();
      await expect(page.locator('main')).not.toHaveAttribute('data-mode', 'light');
      await expectNoHorizontalOverflow(page);
      await axe(page);
      await page.screenshot({
        path: `test-results/n3b-founding-earned-${width}-${mode}.png`,
        fullPage: true,
      });
    });

    test(`the Founding coach page says where a waiting badge stands at ${width}px, ${mode}`, async ({
      page,
    }) => {
      await open(page, '/account/founding', 'Founding coach', {
        width,
        dark,
        extra: foundingApi(WAITING),
      });

      await expect(page.locator('[data-founding-waiting] p')).toHaveText([
        'Your coaching space is one of the first on TB Gym, founding since Sep 15, 2026.',
        'The badge is earned once 12 of your clients have an active plan and your space is 3 months old. So far: 5 of 12 clients, 1 of 3 months.',
      ]);
      await expect(showBadge(page)).toHaveCount(0);
      await expectNoHorizontalOverflow(page);
      await axe(page);
      await page.screenshot({
        path: `test-results/n3b-founding-waiting-${width}-${mode}.png`,
        fullPage: true,
      });
    });
  }

  test(`the Founding coach page reflows with 200% text at ${width}px`, async ({ page }) => {
    await open(page, '/account/founding', 'Founding coach', {
      width,
      extra: foundingApi(EARNED),
    });
    await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });

    await expect(showBadge(page)).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await page.screenshot({ path: `test-results/n3b-founding-200-${width}.png`, fullPage: true });
  });
}

test('the Founding coach row opens the page from Settings, and hiding saves after a fresh token', async ({
  page,
}) => {
  const saves: unknown[] = [];
  const order: string[] = [];
  await open(page, '/account/appearance', 'Appearance', {
    extra: {
      ...foundingApi(EARNED, saves, order),
      'GET /api/auth/csrf': (route) => {
        order.push('token');
        return json(route, 200, { token: 'e2e-csrf' });
      },
    },
  });
  await page
    .getByRole('navigation', { name: 'Settings' })
    .getByRole('link', { name: 'Founding coach' })
    .click();
  await expect(page.getByRole('heading', { name: 'Founding coach', level: 1 })).toBeVisible();
  order.length = 0;

  await showBadge(page).uncheck();

  await expect.poll(() => order).toEqual(['token', 'save']);
  expect(saves).toEqual([{ hidden: true }]);
  await expect(showBadge(page)).not.toBeChecked();
  await page.reload();
  await expect(showBadge(page)).not.toBeChecked();
});

test.describe('when the badge’s switch is refused', () => {
  test.use({
    allowedConsoleErrors: {
      patterns: [/status of 500 .*\/api\/billing\/founding\/visibility/],
    },
  });

  test('puts the box back and says so', async ({ page }) => {
    await open(page, '/account/founding', 'Founding coach', {
      width: 390,
      extra: {
        ...foundingApi(EARNED),
        'PUT /api/billing/founding/visibility': (route) => json(route, 500, { title: 'Failed' }),
      },
    });

    await showBadge(page).uncheck();

    await expect(page.getByRole('alert')).toHaveText('Couldn’t save your choice. Try again.');
    await expect(showBadge(page)).toBeChecked();
    await axe(page);
  });
});

test('an owner whose space is not founding finds no row, and nothing at the address', async ({
  page,
}) => {
  await open(page, '/account/founding', 'Founding coach', {
    width: 390,
    extra: {
      'GET /api/billing/founding': (route) =>
        json(route, 200, { ...EARNED, state: 'NotFounding', foundingSince: null, earnedOn: null }),
    },
  });

  await expect(page.getByRole('navigation', { name: 'Settings' }).getByRole('link')).toHaveText(
    OWNER_LINKS,
  );
  await expect(page.getByRole('heading', { name: 'Nothing here', level: 2 })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Back to Settings' })).toHaveAttribute(
    'href',
    '/workspace',
  );
  await expectNoHorizontalOverflow(page);
  await axe(page);
  await page.screenshot({ path: 'test-results/n3b-founding-nothing-390.png', fullPage: true });
});

test('a coach finds no row and nothing at the address, and nobody asks the server', async ({
  page,
}) => {
  let asked = 0;
  await open(page, '/account/founding', 'Founding coach', {
    memberships: [COACH_MEMBERSHIP],
    extra: {
      // Told Earned, which the server never tells a coach: the row is still the owner's alone.
      'GET /api/billing/access': (route) =>
        json(route, 200, {
          isReadOnly: false,
          hasOverdueInvoice: false,
          readOnlyFrom: null,
          foundingCoach: 'Earned',
        }),
      'GET /api/billing/founding': (route) => {
        asked += 1;
        return json(route, 200, EARNED);
      },
    },
  });

  await expect(page.getByRole('navigation', { name: 'Settings' }).getByRole('link')).toHaveText([
    'Notifications',
    'Appearance',
    'Password and security',
    'Certificates',
    'Team',
  ]);
  await expect(page.getByRole('heading', { name: 'Nothing here', level: 2 })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Back to Settings' })).toHaveAttribute(
    'href',
    '/notifications/settings',
  );
  expect(asked).toBe(0);
  await axe(page);
});
