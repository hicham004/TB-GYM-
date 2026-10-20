import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import type { ClientInvitation } from '../src/app/core/api/api.models';
import { atlasInvitations, invitation, NOW } from '../src/testing/invitation-fixtures';
import {
  expect,
  expectNoHorizontalOverflow,
  json,
  mockSession,
  OWNER_MEMBERSHIP,
  test,
  useRtl,
  waitForFonts,
} from './support';

/**
 * Invitations (R5.3a) in a real browser: who is waiting to join and what happens next, the invite
 * sheet with its typed birth date, a new link and a cancellation after asking. Every API call is a
 * per-test mock answered in place, so a write shows on the next read.
 */
interface Writes {
  created: unknown[];
  resent: unknown[];
  revoked: unknown[];
}

async function openInvitations(
  page: Page,
  width: number,
  options: { dark?: boolean; empty?: boolean; refuse?: boolean } = {},
) {
  await page.clock.setFixedTime(new Date(NOW));
  await page.emulateMedia({ colorScheme: options.dark ? 'dark' : 'light' });
  await page.setViewportSize({ width, height: 900 });
  const writes: Writes = { created: [], resent: [], revoked: [] };
  let list: ClientInvitation[] = options.empty ? [] : atlasInvitations();
  await mockSession(page, {
    extra: {
      'GET /api/auth/csrf': (route) => json(route, 200, { token: 'e2e-csrf' }),
      // Each link is dated on the workspace's clock (audit COACH-6).
      'GET /api/workspace': (route) =>
        json(route, 200, { timeZoneId: 'Asia/Beirut', currentDate: NOW.slice(0, 10) }),
      'GET /api/invitations': (route) => json(route, 200, list),
      'POST /api/invitations': (route) => {
        const body = route.request().postDataJSON() as {
          email: string;
          firstName: string;
          lastName: string;
        };
        writes.created.push(body);
        if (options.refuse) {
          return json(route, 409, {
            title: 'An active invitation or client relationship already exists for this email.',
          });
        }
        const created = invitation({
          id: 'invitation-new',
          email: body.email,
          firstName: body.firstName,
          lastName: body.lastName,
          createdAtUtc: NOW,
          expiresAtUtc: '2026-10-16T12:00:00Z',
        });
        list = [created, ...list];
        return json(route, 200, created);
      },
      'POST /api/invitations/invitation-1/resend': (route) => {
        writes.resent.push(route.request().postDataJSON());
        const updated = invitation({ sendCount: 2, logicalSendGeneration: 2, version: 8 });
        list = list.map((item) => (item.id === updated.id ? updated : item));
        return json(route, 200, updated);
      },
      'POST /api/invitations/invitation-2/revoke': (route) => {
        writes.revoked.push(route.request().postDataJSON());
        const updated = invitation({
          id: 'invitation-2',
          email: 'karl@mail.example',
          firstName: 'Karl',
          lastName: 'Bou Saab',
          status: 'Revoked',
          version: 4,
        });
        list = list.map((item) => (item.id === updated.id ? updated : item));
        return json(route, 200, updated);
      },
    },
  });
  await page.goto('/invitations');
  await expect(page.getByRole('heading', { name: 'Invitations', exact: true })).toBeVisible();
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

for (const width of [390, 1440]) {
  test(`the list shows who is waiting and what happens next at ${width}px and passes axe`, async ({
    page,
  }) => {
    await openInvitations(page, width);

    await expect(page.locator('[data-waiting] .name')).toHaveText(['Rana Haddad', 'Karl Bou Saab']);
    await expect(page.locator('[data-invitation="invitation-2"] .line')).toHaveText(
      'Sent twice · the newest link works until Tue 13 Oct',
    );
    await expect(page.locator('[data-earlier] summary')).toHaveText('Earlier invitations (3)');
    await expectNoHorizontalOverflow(page);
    await axe(page);
    await page.screenshot({ path: `test-results/r53a-invitations-${width}.png`, fullPage: true });

    await page.locator('[data-earlier] summary').click();
    await expect(page.locator('[data-earlier] .name')).toHaveText([
      'Lynn Bou Khalil',
      'Maya Fakhoury',
      'Ali Nasr',
    ]);
    await expectNoHorizontalOverflow(page);
    await axe(page);
    await page.screenshot({
      path: `test-results/r53a-invitations-earlier-${width}.png`,
      fullPage: true,
    });
  });

  test(`it follows dark mode at ${width}px and passes axe`, async ({ page }) => {
    await openInvitations(page, width, { dark: true });

    await expectNoHorizontalOverflow(page);
    await axe(page);
    await page.screenshot({
      path: `test-results/r53a-invitations-dark-${width}.png`,
      fullPage: true,
    });
  });
}

test('an empty page invites the first client', async ({ page }) => {
  await openInvitations(page, 390, { empty: true });

  await expect(page.getByRole('heading', { name: 'No invitations yet' })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await axe(page);
  await page.screenshot({ path: 'test-results/r53a-invitations-empty-390.png', fullPage: true });
});

test('inviting a client types their birth date in three boxes and shows them waiting', async ({
  page,
}) => {
  const writes = await openInvitations(page, 390);
  await page.getByRole('button', { name: 'Invite a client' }).first().click();
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByRole('heading', { name: 'Invite a client' })).toBeVisible();

  await sheet.getByLabel('First name').fill('Dana');
  await sheet.getByLabel('Last name').fill('Mourad');
  await sheet.getByLabel('Email').fill('dana@mail.example');
  await sheet.getByLabel('Day').fill('9');
  await sheet.getByLabel('Month').fill('13');
  await sheet.getByLabel('Year').fill('1995');
  await sheet.getByRole('button', { name: 'Send invitation' }).click();
  await expect(
    sheet.getByText('That day does not exist. Check the day and the month.'),
  ).toBeVisible();
  // The first box of the group takes focus, and all three say what is wrong.
  await expect(sheet.getByLabel('Day')).toBeFocused();
  await expectNoHorizontalOverflow(page);
  await axe(page);
  await page.screenshot({ path: 'test-results/r53a-invite-sheet-390.png' });

  await sheet.getByLabel('Month').fill('12');
  await sheet.getByRole('button', { name: 'Send invitation' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(writes.created).toEqual([
    expect.objectContaining({
      email: 'dana@mail.example',
      firstName: 'Dana',
      lastName: 'Mourad',
      phoneNumber: null,
      birthDate: '1995-12-09',
    }),
  ]);
  await expect(
    page.getByText('Invitation created. We will email dana@mail.example shortly.'),
  ).toBeVisible();
  await expect(page.locator('[data-waiting] .name').first()).toHaveText('Dana Mourad');
});

test.describe('when the server refuses an invitation', () => {
  // The browser logs the failed request itself; what matters is that the sheet says why.
  test.use({ allowedConsoleErrors: { patterns: [/status of 409 .*\/api\/invitations/] } });

  test('the message stays in the sheet and is brought into view above the Send bar', async ({
    page,
  }) => {
    const writes = await openInvitations(page, 390, { refuse: true });
    // A short phone, so the form scrolls and the message at its foot starts below the bar.
    await page.setViewportSize({ width: 390, height: 600 });
    await page.getByRole('button', { name: 'Invite a client' }).first().click();
    const sheet = page.getByRole('dialog');
    await sheet.getByLabel('First name').fill('Rana');
    await sheet.getByLabel('Last name').fill('Haddad');
    await sheet.getByLabel('Email').fill('rana@example.test');
    await sheet.getByRole('button', { name: 'Send invitation' }).click();

    const refusal = sheet.getByRole('alert');
    await expect(refusal).toHaveText(
      'An active invitation or client relationship already exists for this email.',
    );
    await expect(async () => {
      const message = (await refusal.boundingBox())!;
      const bar = (await sheet.locator('.actions').boundingBox())!;
      expect(message.y).toBeGreaterThanOrEqual(0);
      expect(message.y + message.height).toBeLessThanOrEqual(bar.y);
    }).toPass();
    expect(writes.created).toHaveLength(1);
    await expect(sheet.getByLabel('Email')).toHaveValue('rana@example.test');
    await page.screenshot({ path: 'test-results/r53a-invite-refused-390.png' });
  });
});

test('a new link and a cancellation each say what they do', async ({ page }) => {
  const writes = await openInvitations(page, 1440);

  await page.getByRole('button', { name: 'Send again to Rana Haddad' }).click();
  await expect(page.getByText('A new link was sent to rana@example.test.')).toBeVisible();
  expect(writes.resent).toEqual([expect.objectContaining({ version: 7 })]);
  await expect(page.locator('[data-invitation="invitation-1"] .line')).toContainText('Sent twice');

  await page.getByRole('button', { name: 'Cancel the invitation for Karl Bou Saab' }).click();
  const ask = page.getByRole('dialog');
  await expect(ask).toContainText('Cancel the invitation for Karl Bou Saab?');
  await axe(page);
  await ask.getByRole('button', { name: 'Cancel invitation' }).click();
  await expect(page.getByText('The invitation for Karl Bou Saab was cancelled.')).toBeVisible();
  expect(writes.revoked).toEqual([{ version: 3 }]);
  await expect(page.locator('[data-waiting] .name')).toHaveText(['Rana Haddad']);
});

test('inviting again fills in the person whose link ran out', async ({ page }) => {
  await openInvitations(page, 1440);
  await page.locator('[data-earlier] summary').click();
  await page.getByRole('button', { name: 'Invite again Lynn Bou Khalil' }).click();
  const sheet = page.getByRole('dialog');

  await expect(sheet.getByRole('heading', { name: 'Invite Lynn Bou Khalil again' })).toBeVisible();
  await expect(sheet.getByLabel('Email')).toHaveValue('lynn@mail.example');
  await page.screenshot({ path: 'test-results/r53a-invite-again-1440.png' });
});

test('right to left: the list keeps its rows and nothing overflows', async ({ page }) => {
  await openInvitations(page, 390);
  await useRtl(page);

  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: 'test-results/r53a-invitations-rtl-390.png', fullPage: true });
});

test('the coaching space name stays in the sidebar for the owner', async ({ page }) => {
  await openInvitations(page, 1440);
  await expect(page.getByText(OWNER_MEMBERSHIP.tenantName).first()).toBeVisible();
});
