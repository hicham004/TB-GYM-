import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
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
 * The legal documents (audit INV-3, CLI-010) in a real browser: the platform admin's page and its Publish
 * a version sheet, a version as anyone reads it, and the Legal documents block of registration and an
 * invitation. Every answer is a test-only mock, and every document text a placeholder, not legal wording.
 */
const ADMIN = { ...SIGNED_IN_USER, displayName: 'Hicham Haddad', roles: ['PlatformAdmin'] };
const NOW = '2026-10-22T09:00:00Z';

function adminVersion(overrides: Record<string, unknown> = {}) {
  return {
    id: 'terms-2',
    kind: 'TermsOfService',
    version: '2026-11',
    culture: 'en',
    context: 'Platform',
    acceptanceStatement: 'Placeholder sentence for this test, not legal wording.',
    contentUri: '/legal/terms-2',
    contentSha256: 'ab'.repeat(32),
    characterCount: 120,
    publishedAtUtc: '2026-10-01T09:00:00Z',
    retiredAtUtc: null,
    acceptanceCount: 3,
    ...overrides,
  };
}

function toAccept(id: string, kind: string, context = 'Platform') {
  return {
    id,
    kind,
    version: '2026-11',
    culture: 'en',
    context,
    acceptanceStatement: `Placeholder sentence for the ${kind}, not legal wording.`,
    contentUri: `/legal/${id}`,
    publishedAtUtc: '2026-10-01T09:00:00Z',
  };
}

const TEXT = [
  'PLACEHOLDER. Written for a test of the reading page; not legal wording.',
  'Section 1. You may not:\n- share your account, except:\n    - with the coach you invited',
  'Section 2. The last paragraph.',
].join('\n\n');

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

for (const width of [1440, 390]) {
  test.describe(`legal documents at ${width}px`, () => {
    test.beforeEach(async ({ page }) => {
      await page.clock.setFixedTime(new Date(NOW));
      await page.setViewportSize({ width, height: width < 600 ? 844 : 900 });
    });

    test('the platform admin publishes a version after one more question', async ({ page }) => {
      let versions = [
        adminVersion(),
        adminVersion({
          id: 'terms-1',
          version: '2026-10',
          publishedAtUtc: '2026-09-01T09:00:00Z',
          retiredAtUtc: '2026-10-01T09:00:00Z',
          acceptanceCount: 1,
        }),
      ];
      const published: unknown[] = [];
      await mockSession(page, {
        user: ADMIN,
        extra: {
          'GET /api/platform-admin/legal-documents': (route) => json(route, 200, versions),
          'POST /api/platform-admin/legal-documents': (route) => {
            const body = route.request().postDataJSON() as { version: string };
            published.push(body);
            const made = adminVersion({ id: 'terms-3', version: body.version, acceptanceCount: 0 });
            versions = [made, ...versions.map((item) => ({ ...item, retiredAtUtc: NOW }))];
            return json(route, 200, made);
          },
        },
      });
      await page.goto('/admin/legal');
      await expect(page.getByRole('heading', { level: 1, name: 'Legal documents' })).toBeVisible();
      await expect(page.locator('[data-version="terms-2"] .quiet')).toHaveText(
        'Once per person · In force since Thu 1 Oct · Accepted 3 times',
      );
      await waitForFonts(page);
      await axe(page);
      await expectNoHorizontalOverflow(page);
      await page.screenshot({
        path: test.info().outputPath(`legal-admin-${width}.png`),
        fullPage: true,
      });

      await page
        .locator('[data-version="terms-2"]')
        .getByRole('button', { name: /^Publish a new version/ })
        .click();
      const sheet = page
        .getByRole('dialog')
        .filter({ hasText: 'Publish a legal document version' });
      await expect(sheet.locator('[data-replaces]')).toContainText('This replaces version 2026-11');
      await sheet.getByLabel('Version name').fill('2026-12');
      await sheet.getByLabel('The document’s text').fill(TEXT);
      await sheet
        .getByLabel('The sentence people tick')
        .fill('Placeholder sentence, not legal wording.');
      await sheet.getByLabel('A qualified reviewer approved this exact text and sentence.').check();
      await sheet.getByRole('button', { name: 'Publish this version' }).click();
      const question = sheet.locator('[data-confirm]');
      await expect(question).toBeFocused();
      await expect(question).toContainText('Publish the Terms of Service version 2026-12');
      expect(published).toEqual([]);
      await axe(page);
      await page.screenshot({ path: test.info().outputPath(`legal-sheet-confirm-${width}.png`) });

      await sheet.getByRole('button', { name: 'Publish now' }).click();
      await expect(
        page.getByText('Terms of Service version 2026-12 is published.', { exact: false }),
      ).toBeVisible();
      expect(published).toEqual([
        expect.objectContaining({ version: '2026-12', replacesVersionId: 'terms-2' }),
      ]);
      await expect(page.locator('[data-version="terms-3"]')).toBeVisible();
    });

    test('anyone reads a version as it was published, indents kept', async ({ page }) => {
      await mockSignedOut(page, {
        'GET /api/legal/documents/terms-2': (route) =>
          json(route, 200, {
            id: 'terms-2',
            kind: 'TermsOfService',
            version: '2026-11',
            culture: 'en',
            context: 'Platform',
            content: TEXT,
            acceptanceStatement: 'Placeholder sentence, not legal wording.',
            contentSha256: 'ab'.repeat(32),
            publishedAtUtc: '2026-10-01T09:00:00Z',
            retiredAtUtc: null,
          }),
      });
      await page.goto('/legal/terms-2');
      await expect(page.getByRole('heading', { level: 1, name: 'Terms of Service' })).toBeVisible();
      await expect(page).toHaveTitle('Terms of Service | TB Gym');
      const paragraphs = page.locator('[data-legal-text] p');
      await expect(paragraphs).toHaveCount(3);
      // The indent of the exception's line is drawn as it was published.
      expect(await paragraphs.nth(1).evaluate((p) => getComputedStyle(p).whiteSpace)).toBe(
        'pre-wrap',
      );
      await waitForFonts(page);
      await axe(page);
      await expectNoHorizontalOverflow(page);
      await page.screenshot({
        path: test.info().outputPath(`legal-read-${width}.png`),
        fullPage: true,
      });

      // The skip link moves focus to the document and stays on the page (the route focuses the heading
      // on arrival, so the link is reached directly).
      await page.locator('.skip-link').focus();
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(/\/legal\/terms-2$/);
      await expect(page.locator('#legal-content')).toBeFocused();
    });

    test('registration asks a new owner to tick each document in force', async ({ page }) => {
      const sent: unknown[] = [];
      await mockSignedOut(page, {
        'GET /api/legal/documents/to-accept': (route) =>
          json(route, 200, [
            toAccept('terms-2', 'TermsOfService'),
            toAccept('privacy-2', 'PrivacyPolicy'),
          ]),
        'POST /api/auth/register/coach': (route) => {
          sent.push(route.request().postDataJSON());
          return json(route, 202, {
            email: 'owner@example.test',
            developmentConfirmationUrl: null,
            emailAvailable: true,
          });
        },
      });
      await page.goto('/auth/register');
      await expect(page.locator('fieldset[data-legal]')).toBeVisible();
      await page.getByLabel('Your name').fill('Legal Owner');
      await page.getByLabel('Coaching space name').fill('Legal Gym');
      await page.getByLabel('Email').fill('owner@example.test');
      await page.getByLabel('Password', { exact: true }).fill('Legal-Pass-2026!x');
      await page.getByLabel('Confirm password').fill('Legal-Pass-2026!x');
      await page.getByRole('button', { name: 'Create coach account' }).click();

      const summary = page.locator('#register-summary');
      await expect(summary).toContainText('Tick the box for the Terms of Service.');
      await expect(summary).toBeFocused();
      const terms = page.getByLabel(
        'Placeholder sentence for the TermsOfService, not legal wording.',
      );
      await expect(terms).toHaveAttribute('aria-invalid', 'true');
      expect(sent).toEqual([]);
      await waitForFonts(page);
      await axe(page);
      await expectNoHorizontalOverflow(page);
      await page.locator('fieldset[data-legal]').scrollIntoViewIfNeeded();
      await page.screenshot({ path: test.info().outputPath(`legal-register-${width}.png`) });

      await terms.check();
      await page
        .getByLabel('Placeholder sentence for the PrivacyPolicy, not legal wording.')
        .check();
      await page.getByRole('button', { name: 'Create coach account' }).click();
      await expect(page.getByText('Check your email')).toBeVisible();
      expect(sent).toEqual([
        expect.objectContaining({ legalDocumentIds: ['terms-2', 'privacy-2'] }),
      ]);
    });

    test.describe('an invitation', () => {
      test.use({
        allowedConsoleErrors: { patterns: [/status of 409 .*\/api\/invitations\/accept/] },
      });

      test('asks a client for the health consent too, and reads them again when they changed', async ({
        page,
      }) => {
        let reads = 0;
        const sent: unknown[] = [];
        await mockSignedOut(page, {
          'GET /api/invitations/public/invite-token': (route) =>
            json(route, 200, {
              workspaceName: 'Atlas Performance',
              firstName: 'Rana',
              lastName: 'Haddad',
              email: 'rana@example.test',
              expiresAtUtc: '2026-10-29T09:00:00Z',
              status: 'Pending',
              requiresExistingAccountSignIn: false,
              timeZoneId: 'Asia/Beirut',
              kind: 'Client',
            }),
          'GET /api/legal/documents/to-accept': (route) => {
            const terms = reads++ === 0 ? 'terms-2' : 'terms-3';
            return json(route, 200, [
              toAccept(terms, 'TermsOfService'),
              toAccept('privacy-2', 'PrivacyPolicy'),
              toAccept('health-2', 'HealthIntakeConsent', 'Workspace'),
            ]);
          },
          'POST /api/invitations/accept': (route) => {
            sent.push(route.request().postDataJSON());
            return json(route, 409, {
              code: 'legal_acceptance_required',
              message: 'Read and accept the documents shown before you continue.',
            });
          },
        });
        await page.goto('/invite?token=invite-token');
        const block = page.locator('fieldset[data-legal]');
        await expect(block.locator('[data-legal-document]')).toHaveCount(3);
        await page.getByLabel('Password', { exact: true }).fill('Legal-Pass-2026!x');
        await page.getByLabel('Confirm password').fill('Legal-Pass-2026!x');
        for (const box of await block.locator('input[type="checkbox"]').all()) await box.check();
        await page.getByRole('button', { name: 'Create account and join' }).click();

        const summary = page.locator('#invitation-summary');
        await expect(summary).toHaveText(
          'The documents to accept changed while this page was open. Read them again below and tick each box.',
        );
        await expect(summary).toBeFocused();
        expect(sent).toEqual([
          expect.objectContaining({ legalDocumentIds: ['terms-2', 'privacy-2', 'health-2'] }),
        ]);
        // The replaced version comes unticked, the rest stay ticked, and the passwords stay typed.
        await expect(page.locator('#legal-terms-3')).not.toBeChecked();
        await expect(page.locator('#legal-health-2')).toBeChecked();
        await expect(page.getByLabel('Password', { exact: true })).toHaveValue('Legal-Pass-2026!x');
        await waitForFonts(page);
        await axe(page);
        await expectNoHorizontalOverflow(page);
        await block.scrollIntoViewIfNeeded();
        await page.screenshot({ path: test.info().outputPath(`legal-invite-${width}.png`) });
      });
    });
  });
}
