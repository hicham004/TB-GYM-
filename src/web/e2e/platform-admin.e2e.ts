import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import {
  adminFounding,
  atlasDetail,
  endedFounding,
  foundingBadge,
  foundingRecord,
  foundingTerms,
  gymRequests,
  NOW,
  plan,
  platformSpaces,
  pricePlans,
  SPACE_IDS,
  TODAY,
} from '../src/testing/platform-admin-fixtures';
import type {
  AdminWorkspace,
  AdminWorkspaceDetail,
  PricePlan,
} from '../src/app/features/billing/billing.models';
import type { FoundingTerms } from '../src/app/features/billing/founding.models';
import { chooseDay } from './kit-controls';
import {
  expect,
  expectNoHorizontalOverflow,
  json,
  mockSession,
  SIGNED_IN_USER,
  test,
  useRtl,
  waitForFonts,
} from './support';

/**
 * Platform billing (R5.2b, ADR 0028) in a real browser: the overview with its tiles, worst-first
 * list and price plan, one coaching space with its invoices and discounts, and the four sheets that
 * change something, including the kit's date field. Every API call is a per-test mock, answered in
 * place so a write shows on the next read; guards, interceptors and stores run unchanged.
 */
const ADMIN = { ...SIGNED_IN_USER, displayName: 'Hicham Haddad', roles: ['PlatformAdmin'] };

interface Writes {
  payment: unknown[];
  void: unknown[];
  discount: unknown[];
  revoke: unknown[];
  plan: unknown[];
  issue: unknown[];
  mark: unknown[];
  check: unknown[];
  end: unknown[];
  terms: unknown[];
}

async function openAdmin(
  page: Page,
  path: string,
  width: number,
  dark = false,
  start: AdminWorkspaceDetail = atlasDetail(),
) {
  await page.clock.setFixedTime(new Date(NOW));
  await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light' });
  await page.setViewportSize({ width, height: 900 });
  const writes: Writes = {
    payment: [],
    void: [],
    discount: [],
    revoke: [],
    plan: [],
    issue: [],
    mark: [],
    check: [],
    end: [],
    terms: [],
  };
  let spaces: AdminWorkspace[] = platformSpaces();
  let detail: AdminWorkspaceDetail = start;
  let plans: PricePlan[] = pricePlans();
  let terms: FoundingTerms[] = [foundingTerms()];
  // The list follows the space's page as the server would (notes plan N3b).
  const sync = () => {
    detail = {
      ...detail,
      summary: {
        ...detail.summary,
        isFounding: detail.founding !== null,
        badgeEarnedOn: detail.founding?.status.earnedOn ?? null,
      },
    };
    spaces = spaces.map((item) => (item.tenantId === SPACE_IDS.atlas ? detail.summary : item));
  };
  await mockSession(page, {
    user: ADMIN,
    extra: {
      'GET /api/auth/csrf': (route) => json(route, 200, { token: 'e2e-csrf' }),
      'GET /api/platform-admin/workspaces': (route) => json(route, 200, spaces),
      'GET /api/platform-admin/price-plans': (route) => json(route, 200, plans),
      'GET /api/platform-admin/contact-requests': (route) => json(route, 200, gymRequests()),
      [`GET /api/platform-admin/workspaces/${SPACE_IDS.atlas}`]: (route) =>
        json(route, 200, detail),
      'POST /api/platform-admin/invoices/invoice-sep/payments': (route) => {
        const body = route.request().postDataJSON() as { receivedOn: string; reference: string };
        writes.payment.push(body);
        detail = {
          ...detail,
          summary: {
            ...detail.summary,
            status: 'Active',
            unpaidTotal: 0,
            oldestUnpaidDueOn: null,
            readOnlyFrom: null,
          },
          invoices: detail.invoices.map((item) =>
            item.id === 'invoice-sep'
              ? {
                  ...item,
                  status: 'Paid',
                  payment: {
                    id: 'payment-sep',
                    amount: 55,
                    currencyCode: 'USD',
                    reference: body.reference,
                    note: null,
                    receivedOn: body.receivedOn,
                    recordedAtUtc: NOW,
                  },
                }
              : item,
          ),
        };
        spaces = spaces.map((item) => (item.tenantId === SPACE_IDS.atlas ? detail.summary : item));
        return json(route, 200, { id: 'payment-sep' });
      },
      'POST /api/platform-admin/invoices/invoice-sep/void': (route) => {
        writes.void.push(route.request().postDataJSON());
        return json(route, 200, {});
      },
      [`POST /api/platform-admin/workspaces/${SPACE_IDS.atlas}/discounts`]: (route) => {
        writes.discount.push(route.request().postDataJSON());
        return json(route, 200, {});
      },
      'POST /api/platform-admin/discounts/discount-1/revoke': (route) => {
        writes.revoke.push(route.request().postDataJSON());
        return json(route, 200, {});
      },
      'POST /api/platform-admin/price-plans': (route) => {
        const body = route.request().postDataJSON() as { seatPrice: number };
        writes.plan.push(body);
        plans = [
          plan({ id: 'plan-3', versionNumber: 3, seatPrice: body.seatPrice, note: null }),
          ...plans.map((item) => ({ ...item, isCurrent: false })),
        ];
        return json(route, 200, plans[0]);
      },
      'POST /api/platform-admin/invoices/issue': (route) => {
        writes.issue.push(route.request().postDataJSON());
        return json(route, 200, {
          periodStart: '2026-09-01',
          issued: 1,
          alreadyIssued: 0,
          inTrial: 2,
        });
      },
      // The Founding coach badge (notes plan N3b), answered as N3a's API does.
      'GET /api/platform-admin/founding-terms': (route) => json(route, 200, terms),
      'POST /api/platform-admin/founding-terms': (route) => {
        const body = route.request().postDataJSON() as {
          clientsWithActivePlan: number;
          monthsSinceStart: number;
          note: string | null;
          expectedCurrentVersion: number;
        };
        writes.terms.push(body);
        const next = foundingTerms({
          id: `terms-${terms.length + 1}`,
          versionNumber: terms.length + 1,
          clientsWithActivePlan: body.clientsWithActivePlan,
          monthsSinceStart: body.monthsSinceStart,
          note: body.note,
          publishedAtUtc: NOW,
        });
        terms = [next, ...terms.map((item) => ({ ...item, isCurrent: false }))];
        return json(route, 200, next);
      },
      [`POST /api/platform-admin/workspaces/${SPACE_IDS.atlas}/founding`]: (route) => {
        const body = route.request().postDataJSON() as { foundingSince: string; note: string };
        writes.mark.push(body);
        detail = {
          ...detail,
          founding: {
            status: foundingRecord({
              foundingSince: body.foundingSince,
              note: body.note,
              markedAtUtc: NOW,
            }),
            badge: foundingBadge({ foundingSince: body.foundingSince }),
          },
        };
        sync();
        return json(route, 200, detail.founding);
      },
      'POST /api/platform-admin/founding/check': (route) => {
        writes.check.push(route.request().postDataJSON());
        const open = detail.founding;
        if (open && open.badge.state === 'Waiting') {
          detail = {
            ...detail,
            founding: {
              status: {
                ...open.status,
                earnedOn: TODAY,
                earnedUnderTermsVersion: 1,
                earnedClientCount: 11,
              },
              badge: {
                ...open.badge,
                state: 'Earned',
                clientsWithActivePlan: null,
                monthsSinceStart: null,
                earnedOn: TODAY,
              },
            },
          };
          sync();
        }
        return json(route, 200, { checked: 1, earned: open ? 1 : 0 });
      },
      'POST /api/platform-admin/founding/founding-1/end': (route) => {
        const body = route.request().postDataJSON() as { reason: string };
        writes.end.push(body);
        const open = detail.founding!;
        detail = {
          ...detail,
          founding: null,
          foundingHistory: [
            { ...open.status, endedAtUtc: NOW, endReason: body.reason },
            ...detail.foundingHistory,
          ],
        };
        sync();
        return json(route, 200, {
          status: detail.foundingHistory[0],
          badge: { ...open.badge, state: 'Ended', endedOn: TODAY },
        });
      },
    },
  });
  await page.goto(path);
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

const overviewHeading = (page: Page) =>
  page.getByRole('heading', { name: 'Platform billing', exact: true });

for (const width of [390, 1440]) {
  test(`the overview lists the coaching spaces worst first at ${width}px and passes axe`, async ({
    page,
  }) => {
    await openAdmin(page, '/admin/billing', width);
    await expect(overviewHeading(page)).toBeVisible();

    await expect(page.locator('app-stat-tile .value')).toHaveText(['$155.00', '1', '1', '1']);
    await expect(page.locator('.space .name')).toHaveText([
      'Cedar Barbell Club',
      'Atlas Performance',
      'Beirut Barbell',
      'Strength Lab',
      'Nour Fitness',
      'نادي الأرز',
      'Maya Rahme Coaching',
    ]);
    await expect(page.locator('.chip')).toHaveText([
      'All 7',
      'Needs payment 3',
      'On trial 2',
      'Paid up 2',
    ]);
    await expect(page.locator('[data-price-plan] .panel-head .quiet')).toHaveText(
      'Version 2 · in force since Sep 20, 2026',
    );

    // Requests from gyms whose email has not gone out (audit BEB-1), newest first.
    const requests = page.locator('[data-gym-requests]');
    await expect(requests.getByRole('heading', { name: 'Requests from gyms' })).toBeVisible();
    await expect(requests.locator('.request .gym strong')).toHaveText([
      'Oakline Strength',
      'Cedar Barbell Club',
    ]);
    await expect(requests.locator('.request app-status-pill')).toHaveText([
      'Waiting for email',
      'Email failed',
    ]);
    await expect(requests.getByRole('link', { name: '+96170123456' })).toHaveAttribute(
      'href',
      'https://wa.me/96170123456',
    );
    await expect(requests.getByRole('link', { name: 'nadine@cedar.example' })).toHaveAttribute(
      'href',
      'mailto:nadine@cedar.example',
    );
    await expectNoHorizontalOverflow(page);
    await axe(page);
    await page.screenshot({ path: `test-results/r52b-overview-${width}.png`, fullPage: true });
  });

  test(`the overview follows dark mode at ${width}px and passes axe`, async ({ page }) => {
    await openAdmin(page, '/admin/billing', width, true);
    await expect(overviewHeading(page)).toBeVisible();

    await expectNoHorizontalOverflow(page);
    await axe(page);
    await page.screenshot({ path: `test-results/r52b-overview-dark-${width}.png`, fullPage: true });
  });

  test(`a coaching space shows its invoices, this month and discounts at ${width}px and passes axe`, async ({
    page,
  }) => {
    await openAdmin(page, `/admin/billing/${SPACE_IDS.atlas}`, width);
    await expect(page.getByRole('heading', { name: 'Atlas Performance', level: 1 })).toBeVisible();

    await expect(page.locator('[data-unpaid]')).toHaveText('Owes $55.00');
    await expect(page.locator('[data-invoice] .inv-month')).toHaveText([
      'September 2026',
      'August 2026',
      'July 2026',
      'July 2026',
    ]);
    await expect(page.locator('[data-invoice="invoice-jul"]')).toContainText('Replaced by');
    await expect(page.locator('[data-discount] app-status-pill')).toHaveText([
      'Running now',
      'Revoked',
    ]);
    await expectNoHorizontalOverflow(page);
    await axe(page);
    await page.screenshot({ path: `test-results/r52b-space-${width}.png`, fullPage: true });
  });
}

test('a coaching space follows dark mode and passes axe', async ({ page }) => {
  await openAdmin(page, `/admin/billing/${SPACE_IDS.atlas}`, 1440, true);
  await expect(page.getByRole('heading', { name: 'Atlas Performance', level: 1 })).toBeVisible();

  await expectNoHorizontalOverflow(page);
  await axe(page);
  await page.screenshot({ path: 'test-results/r52b-space-dark-1440.png', fullPage: true });
});

test('filters, search and a row open the right coaching space', async ({ page }) => {
  await openAdmin(page, '/admin/billing', 1440);
  await page.getByText('Needs payment', { exact: false }).first().click();
  await expect(page.locator('.space .name')).toHaveText([
    'Cedar Barbell Club',
    'Atlas Performance',
    'Beirut Barbell',
  ]);
  await expect(page).toHaveURL(/show=owing/);

  await page.getByLabel('Search coaching spaces').fill('karim');
  await expect(page.locator('.space .name')).toHaveText(['Atlas Performance']);
  await page.getByLabel('Search coaching spaces').fill('nobody here');
  await expect(page.getByRole('heading', { name: /No coaching space matches/ })).toBeVisible();
  await page.getByRole('button', { name: 'Clear search' }).first().click();
  await expect(page.locator('.space')).toHaveCount(3);

  await page.locator(`[data-space="${SPACE_IDS.atlas}"]`).click({ position: { x: 300, y: 20 } });
  await expect(page).toHaveURL(new RegExp(`/admin/billing/${SPACE_IDS.atlas}$`));
  await expect(page.getByRole('heading', { name: 'Atlas Performance', level: 1 })).toBeFocused();
});

test('recording a payment dated a few days ago, through the calendar with the keyboard', async ({
  page,
}) => {
  const writes = await openAdmin(page, `/admin/billing/${SPACE_IDS.atlas}`, 390);
  await page.getByRole('button', { name: 'Record payment September 2026' }).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByRole('heading', { name: 'Record payment' })).toBeVisible();
  await expect(sheet.locator('.amount')).toContainText('$55.00');

  await sheet.getByLabel('Whish or transfer reference').fill('WHISH-42');
  const received = sheet.getByRole('button', { name: /Received on/ });
  await expect(received).toContainText('Fri, Oct 9, 2026');
  await received.click();
  const today = sheet.locator('button.day[data-date="2026-10-09"]');
  await expect(today).toBeFocused();
  await expect(sheet.locator('button.day[data-date="2026-10-10"]')).toHaveAttribute(
    'aria-disabled',
    'true',
  );
  await expect(sheet.locator('button.day[data-date="2026-09-30"]')).toHaveAttribute(
    'aria-disabled',
    'true',
  );
  await expectNoHorizontalOverflow(page);
  await axe(page);
  await page.screenshot({ path: 'test-results/r52b-payment-calendar-390.png' });

  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await expect(sheet.locator('button.day[data-date="2026-10-07"]')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(received).toContainText('Wed, Oct 7, 2026');
  await expect(received).toBeFocused();

  await sheet.getByRole('button', { name: 'Record payment' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(writes.payment).toEqual([
    { amount: 55, reference: 'WHISH-42', note: null, receivedOn: '2026-10-07' },
  ]);
  await expect(page.getByText('Payment recorded for TBG-202609-KX4P7Q.')).toBeVisible();
  await expect(page.locator('[data-invoice="invoice-sep"] app-status-pill')).toHaveText('Paid');
  await expect(page.locator('[data-record-payment]')).toHaveCount(0);
  await expect(page.locator('[data-space-status] app-status-pill')).toHaveText('Active');
});

test('Escape closes the calendar first and the sheet only the second time', async ({ page }) => {
  await openAdmin(page, `/admin/billing/${SPACE_IDS.atlas}`, 1440);
  await page.getByRole('button', { name: 'Record payment September 2026' }).click();
  const sheet = page.getByRole('dialog');
  await sheet.getByRole('button', { name: /Received on/ }).click();
  await expect(sheet.locator('.panel')).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(sheet.locator('.panel')).toHaveCount(0);
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole('button', { name: /Received on/ })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('a payment sheet refuses a missing reference in words and keeps the screen reader informed', async ({
  page,
}) => {
  await openAdmin(page, `/admin/billing/${SPACE_IDS.atlas}`, 390);
  await page.getByRole('button', { name: 'Record payment September 2026' }).click();
  const sheet = page.getByRole('dialog');

  await sheet.getByRole('button', { name: 'Record payment' }).click();
  await expect(sheet.getByText('Enter the Whish or transfer reference.')).toBeVisible();
  await expect(sheet.getByLabel('Whish or transfer reference')).toBeFocused();
  await expect(sheet.getByRole('alert')).toHaveText('Check the fields marked above.');
  await axe(page);
});

test('voiding an invoice with a replacement says what will happen first', async ({ page }) => {
  const writes = await openAdmin(page, `/admin/billing/${SPACE_IDS.atlas}`, 390);
  await page.getByRole('button', { name: 'Void September 2026' }).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet.locator('.notice')).toContainText(
    'A new invoice for September 2026 is issued today',
  );
  await sheet.getByLabel('Why is it void?').fill('Wrong seat count');
  await expectNoHorizontalOverflow(page);
  await axe(page);
  await page.screenshot({ path: 'test-results/r52b-void-390.png' });

  await sheet.getByRole('button', { name: 'Void and reissue' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(writes.void).toEqual([{ reason: 'Wrong seat count', reissue: true }]);
});

test('granting a discount of a chosen length, then revoking one after asking', async ({ page }) => {
  const writes = await openAdmin(page, `/admin/billing/${SPACE_IDS.atlas}`, 390);

  await page.getByRole('button', { name: 'Grant a discount' }).click();
  const sheet = page.getByRole('dialog');
  await sheet.getByLabel('Percent off').fill('100');
  // N7: the note is what the owner's Billing page names the discount by.
  await expect(sheet.getByLabel('What it is for')).toHaveAccessibleDescription(
    'The owner sees this as the discount’s name.',
  );
  await sheet.getByLabel('What it is for').fill('Founding coach');
  // The running 30% discount covers until 30 November: the sheet says so before the server does.
  await sheet.getByRole('button', { name: '3 months' }).click();
  await sheet.getByRole('button', { name: 'Grant discount' }).click();
  await expect(sheet.getByText(/That overlaps the 30% discount/)).toBeVisible();
  expect(writes.discount).toEqual([]);

  // Focus reaches a day after a redraw, so a key pressed before it lands is lost.
  await sheet.getByRole('button', { name: /First day/ }).click();
  await expect(sheet.locator('button.day[data-date="2026-10-09"]')).toBeFocused();
  await page.keyboard.press('PageDown');
  await expect(sheet.locator('button.day[data-date="2026-11-09"]')).toBeFocused();
  await page.keyboard.press('PageDown');
  await expect(sheet.locator('button.day[data-date="2026-12-09"]')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(sheet.getByRole('button', { name: /First day/ })).toContainText('Dec 9, 2026');
  await sheet.getByRole('button', { name: '6 months' }).click();
  await expectNoHorizontalOverflow(page);
  await axe(page);
  await page.screenshot({ path: 'test-results/r52b-discount-390.png' });
  await sheet.getByRole('button', { name: 'Grant discount' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(writes.discount).toEqual([
    {
      percent: 100,
      startsOn: '2026-12-09',
      endsOnExclusive: '2027-06-09',
      note: 'Founding coach',
    },
  ]);

  await page.getByRole('button', { name: 'Revoke 30% Founding coach' }).click();
  const confirm = page.getByRole('dialog');
  await expect(confirm).toContainText('Invoices already issued keep it');
  await confirm.getByRole('button', { name: 'Revoke discount' }).click();
  await expect(page.getByText('Discount revoked.')).toBeVisible();
  expect(writes.revoke).toHaveLength(1);
});

test('publishing a price plan version shows what changes and asks before losing it', async ({
  page,
}) => {
  const writes = await openAdmin(page, '/admin/billing', 1440);
  await page.getByRole('button', { name: 'Publish a new version' }).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByText('Nothing has changed yet.')).toBeVisible();
  await expect(sheet.getByRole('button', { name: 'Publish version 3' })).toBeDisabled();

  await sheet.getByLabel('Price per seat').fill('20');
  await sheet.getByLabel('Free trial (days)').fill('14');
  await expect(sheet.locator('.changes li')).toHaveCount(2);
  await expectNoHorizontalOverflow(page);
  await axe(page);
  await page.screenshot({ path: 'test-results/r52b-plan-1440.png' });

  await page.keyboard.press('Escape');
  const ask = page.getByRole('dialog').last();
  await expect(ask).toContainText('Close without publishing?');
  await ask.getByRole('button', { name: 'Keep editing' }).click();
  await expect(sheet.getByLabel('Price per seat')).toHaveValue('20');

  await sheet.getByRole('button', { name: 'Publish version 3' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(writes.plan).toEqual([
    expect.objectContaining({ seatPrice: 20, trialDays: 14, expectedCurrentVersion: 2 }),
  ]);
  await expect(page.getByText('Price plan version 3 is published.')).toBeVisible();
  await expect(page.locator('[data-price-plan] .panel-head .quiet')).toContainText('Version 3');
});

test('issuing last month’s invoices asks first and says what the run did', async ({ page }) => {
  const writes = await openAdmin(page, '/admin/billing', 390);
  await page.getByRole('button', { name: 'Issue last month’s invoices' }).click();
  const ask = page.getByRole('dialog');
  await expect(ask).toContainText('Issue the invoices for September 2026 now?');
  await axe(page);
  await ask.getByRole('button', { name: 'Issue invoices' }).click();
  await expect(
    page.getByText('Invoices for September 2026: 1 issued, 0 already issued, 2 in trial.'),
  ).toBeVisible();
  expect(writes.issue).toEqual([{ periodStart: null }]);
});

test('right to left: the overview keeps its rows and the calendar its arrows', async ({ page }) => {
  await openAdmin(page, '/admin/billing', 390);
  await useRtl(page);
  await expect(page.locator('.space .name').nth(5)).toHaveText('نادي الأرز');
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: 'test-results/r52b-overview-rtl-390.png', fullPage: true });

  await page.goto(`/admin/billing/${SPACE_IDS.atlas}`);
  await useRtl(page);
  await page.getByRole('button', { name: 'Record payment September 2026' }).click();
  const sheet = page.getByRole('dialog');
  await sheet.getByRole('button', { name: /Received on/ }).click();
  // In a right-to-left page the right arrow moves to the day before, which is on the right.
  await page.keyboard.press('ArrowRight');
  await expect(sheet.locator('button.day[data-date="2026-10-08"]')).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(sheet.locator('button.day[data-date="2026-10-09"]')).toBeFocused();
});

test('an admin without a coaching space of their own gets the plain top bar', async ({ page }) => {
  await page.clock.setFixedTime(new Date(NOW));
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockSession(page, {
    user: ADMIN,
    memberships: [],
    extra: {
      'GET /api/platform-admin/workspaces': (route) => json(route, 200, platformSpaces()),
      'GET /api/platform-admin/price-plans': (route) => json(route, 200, pricePlans()),
      'GET /api/platform-admin/contact-requests': (route) => json(route, 200, []),
      'GET /api/platform-admin/founding-terms': (route) => json(route, 200, [foundingTerms()]),
    },
  });
  await page.goto('/admin/billing');
  await expect(overviewHeading(page)).toBeVisible();
  await expect(page.locator('.space')).toHaveCount(7);
  await expect(page.locator('[data-no-requests]')).toHaveText(
    'None waiting. Every request reached your inbox.',
  );
  await axe(page);
  await page.screenshot({ path: 'test-results/r52b-overview-no-workspace-1440.png' });
});

// ---------- the Founding coach badge (notes plan N3b) ----------

for (const width of [390, 1440]) {
  test(`marking a space as founding, checking it now and ending it for cause at ${width}px`, async ({
    page,
  }) => {
    const writes = await openAdmin(page, `/admin/billing/${SPACE_IDS.atlas}`, width);
    const founding = page.locator('[data-founding]');
    await expect(founding.getByRole('heading', { name: 'Founding space' })).toBeVisible();
    await expect(founding.locator('[data-not-founding]')).toHaveText('Not a founding space.');

    await founding.getByRole('button', { name: 'Mark as founding' }).click();
    const mark = page.getByRole('dialog');
    await expect(mark.getByRole('heading', { name: 'Mark as founding' })).toBeVisible();
    await expect(mark.locator('[data-founding-terms-sentence]')).toHaveText(
      'The badge is earned once 10 of the space’s clients have an active plan and the space is 2 months old (the terms in force). The discount is separate: grant it on this page too.',
    );
    await expect(mark.getByRole('button', { name: /Founding since/ })).toContainText('Oct 9, 2026');
    // An earlier day, through the calendar; a pasted link as the note must wrap, not widen the page.
    await chooseDay(mark, 'Founding since', '2026-09-15');
    await mark
      .getByLabel('What it is for')
      .fill('https://www.instagram.com/p/C9xYzAbCdEfGhIjKlMn/?igsh=MWQ1ZGUxMzBkMA==');
    await expectNoHorizontalOverflow(page);
    await axe(page);
    await page.screenshot({ path: `test-results/n3b-mark-${width}.png` });
    await mark.getByRole('button', { name: 'Mark as founding' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(writes.mark).toEqual([
      {
        foundingSince: '2026-09-15',
        note: 'https://www.instagram.com/p/C9xYzAbCdEfGhIjKlMn/?igsh=MWQ1ZGUxMzBkMA==',
      },
    ]);
    await expect(founding.locator('[data-founding-since]')).toHaveText(
      'Founding since Sep 15, 2026 · https://www.instagram.com/p/C9xYzAbCdEfGhIjKlMn/?igsh=MWQ1ZGUxMzBkMA==',
    );
    await expect(founding.locator('[data-founding-progress]')).toHaveText(
      'Badge: 7 of 10 clients with an active plan right now · 1 of 2 months since the space started.',
    );
    await expectNoHorizontalOverflow(page);
    await axe(page);
    await page.screenshot({ path: `test-results/n3b-space-waiting-${width}.png`, fullPage: true });

    await founding.getByRole('button', { name: 'Check now' }).click();
    await expect(page.getByText('Checked: the Founding coach badge is earned.')).toBeVisible();
    expect(writes.check).toHaveLength(1);
    await expect(founding.locator('[data-founding-earned] app-status-pill')).toHaveText(
      'Founding coach',
    );
    await expect(founding.locator('[data-founding-earned] .next')).toHaveText(
      'Badge earned Oct 9, 2026',
    );
    await expect(founding.getByRole('button', { name: 'Check now' })).toHaveCount(0);
    // Where it stands keeps its one pill.
    await expect(page.locator('[data-space-status] app-status-pill')).toHaveText('Overdue');
    await expectNoHorizontalOverflow(page);
    await axe(page);
    await page.screenshot({ path: `test-results/n3b-space-earned-${width}.png`, fullPage: true });

    await founding.getByRole('button', { name: 'End founding status' }).click();
    const end = page.getByRole('dialog');
    await expect(end).toContainText(
      'The badge leaves the coach’s account and their clients’ Me page at once.',
    );
    await end.getByRole('button', { name: 'Misrepresented qualifications' }).click();
    await expect(end.getByLabel('Why?')).toHaveValue('Misrepresented qualifications');
    await expectNoHorizontalOverflow(page);
    await axe(page);
    await page.screenshot({ path: `test-results/n3b-end-${width}.png` });
    await end.getByRole('button', { name: 'End founding status' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(writes.end).toEqual([{ reason: 'Misrepresented qualifications' }]);
    await expect(founding.locator('[data-not-founding]')).toHaveText('Not a founding space.');
    await expect(founding.locator('[data-founding-history] .history-end')).toHaveText(
      'Ended Oct 9, 2026: Misrepresented qualifications',
    );
    await expect(founding.getByRole('button', { name: 'Mark as founding' })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await axe(page);
    await page.screenshot({ path: `test-results/n3b-space-ended-${width}.png`, fullPage: true });
  });

  test(`a founding space shows its pill on the list, and the badge’s terms change at ${width}px`, async ({
    page,
  }) => {
    const writes = await openAdmin(page, '/admin/billing', width);
    await expect(page.locator(`[data-space="${SPACE_IDS.nour}"] app-status-pill`)).toHaveText([
      'Active',
      'Founding',
    ]);
    await expect(page.locator('.space [data-founding]')).toHaveCount(1);
    const panel = page.locator('[data-founding-terms]');
    await expect(panel.getByRole('heading', { name: 'Founding coach badge' })).toBeVisible();
    await expect(panel.locator('.panel-head .quiet')).toHaveText('Version 1 · since Sep 1, 2026');
    await expect(panel.locator('[data-terms-sentence]')).toHaveText(
      'Earned once 10 of a founding space’s clients have an active plan and the space is 2 months old.',
    );

    await panel.getByRole('button', { name: 'Change', exact: true }).click();
    const sheet = page.getByRole('dialog');
    await expect(sheet.getByRole('heading', { name: 'Change the badge’s terms' })).toBeVisible();
    await expect(sheet.getByRole('button', { name: 'Publish version 2' })).toBeDisabled();
    await sheet.getByLabel('Clients with an active plan').fill('12');
    await sheet.getByLabel('Months since the space started').fill('3');
    await expect(sheet.locator('.changes li')).toHaveCount(2);
    await expectNoHorizontalOverflow(page);
    await axe(page);
    await page.screenshot({ path: `test-results/n3b-terms-${width}.png` });

    await sheet.getByRole('button', { name: 'Publish version 2' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(writes.terms).toEqual([
      { clientsWithActivePlan: 12, monthsSinceStart: 3, note: null, expectedCurrentVersion: 1 },
    ]);
    await expect(panel.locator('.panel-head .quiet')).toHaveText('Version 2 · since Oct 9, 2026');
    await expect(panel.locator('[data-terms-sentence]')).toHaveText(
      'Earned once 12 of a founding space’s clients have an active plan and the space is 3 months old.',
    );
    await page.screenshot({ path: `test-results/n3b-overview-${width}.png`, fullPage: true });
  });

  test(`an earned, hidden badge with its history follows dark mode at ${width}px`, async ({
    page,
  }) => {
    await openAdmin(
      page,
      `/admin/billing/${SPACE_IDS.atlas}`,
      width,
      true,
      atlasDetail({ founding: adminFounding('Earned', true), foundingHistory: [endedFounding()] }),
    );
    await expect(page.locator('[data-founding-earned] .next')).toHaveText(
      'Badge earned Oct 3, 2026 · Hidden by the coach',
    );
    await expect(page.locator('[data-founding-history] .history-end')).toHaveText(
      'Ended Aug 20, 2026: The coach asked to leave the founding group',
    );
    await expectNoHorizontalOverflow(page);
    await axe(page);
    await page.screenshot({
      path: `test-results/n3b-space-earned-dark-${width}.png`,
      fullPage: true,
    });

    await page.goto('/admin/billing');
    await expect(page.locator('[data-founding-terms] [data-terms-sentence]')).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await axe(page);
    await page.screenshot({ path: `test-results/n3b-overview-dark-${width}.png`, fullPage: true });
  });
}

test('the founding panel and the badge’s terms reflow at 200% text', async ({ page }) => {
  await openAdmin(
    page,
    `/admin/billing/${SPACE_IDS.atlas}`,
    390,
    false,
    atlasDetail({ founding: adminFounding('Waiting'), foundingHistory: [endedFounding()] }),
  );
  await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
  await expect(page.locator('[data-founding-progress]')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Check now' })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: 'test-results/n3b-space-200.png', fullPage: true });

  await page.goto('/admin/billing');
  await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
  await expect(page.locator('[data-founding-terms] [data-terms-sentence]')).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: 'test-results/n3b-overview-200.png', fullPage: true });
});

test.describe('a stale version of the badge’s terms', () => {
  test.use({ allowedConsoleErrors: { patterns: [/status of 409/] } });

  test('keeps the server’s refusal in the sheet with what was typed', async ({ page }) => {
    const writes = await openAdmin(page, '/admin/billing', 1440);
    // Another admin published version 2 since this page loaded: the server refuses version 1's.
    await page.route('**/api/platform-admin/founding-terms', (route) =>
      route.request().method() === 'POST'
        ? json(route, 409, {
            code: 'founding_terms_changed',
            message:
              'Newer founding badge terms were published since this page loaded. Refresh and try again.',
          })
        : route.fallback(),
    );

    await page
      .locator('[data-founding-terms]')
      .getByRole('button', { name: 'Change', exact: true })
      .click();
    const sheet = page.getByRole('dialog');
    await sheet.getByLabel('Clients with an active plan').fill('8');
    await sheet.getByRole('button', { name: 'Publish version 2' }).click();

    await expect(sheet.getByRole('alert')).toHaveText(
      'Newer founding badge terms were published since this page loaded. Refresh and try again.',
    );
    await expect(sheet.getByLabel('Clients with an active plan')).toHaveValue('8');
    expect(writes.terms).toEqual([]);
    await axe(page);
  });
});
