import AxeBuilder from '@axe-core/playwright';
import type { Page, Route } from '@playwright/test';
import { historyPage, programView } from '../src/testing/training-program-fixtures';
import {
  expect,
  expectNoHorizontalOverflow,
  json,
  mockSession,
  SIGNED_IN_USER,
  test,
  waitForFonts,
} from './support';

const membership = {
  tenantId: '00000000-0000-4000-8000-000000000003',
  tenantName: 'Atlas Performance',
  tenantSlug: 'atlas-performance',
  role: 'Client',
};
const user = {
  ...SIGNED_IN_USER,
  id: '00000000-0000-4000-8000-0000000000bb',
  displayName: 'Maya Fakhoury',
};
const decisions = ['Training', 'Nutrition', 'CheckIns', 'Messaging', 'ResourceLibrary'].map(
  (feature) => ({ feature, isAllowed: true, reason: 'Granted' }),
);

async function openTraining(page: Page, width: number, height: number) {
  await page.setViewportSize({ width, height });
  await mockSession(page, {
    memberships: [membership],
    user,
    extra: {
      'GET /api/client-access/me': (route: Route) => json(route, 200, decisions),
      'GET /api/training/me/program': (route: Route) => json(route, 200, programView()),
      'GET /api/training/me/history': (route: Route) => json(route, 200, historyPage()),
    },
  });
  await page.goto('/training/program');
  await expect(page.getByRole('heading', { name: 'Training', level: 1 })).toBeVisible();
  await expect(page.getByText('Personal record:')).toBeAttached();
  await waitForFonts(page);
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

for (const [width, height] of [
  [390, 844],
  [1440, 900],
] as const) {
  test(`the Training tab at ${width}px leads with the program and today's workout`, async ({
    page,
  }) => {
    await openTraining(page, width, height);

    await expect(page.getByRole('link', { name: 'Training' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    const hero = page.locator('.hero');
    await expect(hero.locator('.hero-eyebrow')).toHaveText('Week 3 of 4');
    await expect(hero.getByRole('heading', { level: 2 })).toHaveText('Strength Foundations');
    await expect(hero.getByRole('link', { name: 'Start workout' })).toHaveAttribute(
      'href',
      '/training/today?sessionId=s6',
    );
    await expect(page.getByRole('heading', { name: 'This week' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Finished workouts' })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await axe(page);
    await page.screenshot({ path: `test-results/r25b-training-${width}.png`, fullPage: true });
  });
}

test('an earlier week opens and closes from the keyboard, and shows what was missed', async ({
  page,
}) => {
  await openTraining(page, 390, 844);

  const week = page.getByRole('button', { name: /Week 2/ });
  await expect(week).toHaveAttribute('aria-expanded', 'false');
  await week.focus();
  await page.keyboard.press('Enter');
  await expect(week).toHaveAttribute('aria-expanded', 'true');
  const body = page.locator('#week-2');
  await expect(body.locator('.session-tag')).toHaveText(['Done', 'Missed']);
  await axe(page);

  await page.keyboard.press('Space');
  await expect(week).toHaveAttribute('aria-expanded', 'false');
  await expect(body).toHaveCount(0);
});

test('the page reflows at 200% text without sideways scrolling', async ({ page }) => {
  await openTraining(page, 390, 844);
  await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
  await expectNoHorizontalOverflow(page);
  await expect(page.locator('a.hero-action')).toBeVisible();
});
