import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { personFacing } from '../axe-target-size';
import { ACCOUNTS, api, expect, memberships, requireLive, signIn, test } from './support';

/**
 * Accessibility sweep (full audit, October 2026): axe on the main coach and client routes of the
 * live app, at phone and desktop width, asserting zero WCAG 2.0 to 2.2 A/AA violations. The routes
 * that need an id (a client's record, a program, a meal plan) are read from the API, so the sweep
 * follows a rebuilt demo. A violation found here is a real defect: it stays failing. A target the
 * client's sticky tab bar covers at the first scroll is judged where a person reaches it (CLIENT-7).
 */
requireLive();

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'];

const VIEWPORTS = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'desktop', width: 1440, height: 900 },
];

const COACH_ROUTES = [
  '/',
  '/clients',
  '/invitations',
  '/training/programs',
  '/training/exercises',
  '/nutrition/plans',
  '/nutrition/recipes',
  '/nutrition/foods',
  '/checkins/forms',
  '/checkins/clients',
  '/messages',
  '/notifications',
  '/notifications/settings',
  '/products',
  '/account/security',
  '/account/appearance',
];

const CLIENT_ROUTES = [
  '/',
  '/training/program',
  '/training/today',
  '/nutrition/today',
  '/progress/dashboard',
  '/progress',
  '/progress?tab=measurements',
  '/progress?tab=photos',
  '/checkins/me',
  '/messages',
  '/notifications',
  '/notifications/settings',
  '/me',
  '/profile',
  '/account/security',
  '/account/appearance',
];

async function settled(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => undefined);
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator('h1').first()).toBeVisible({ timeout: 30_000 });
}

/** Every violation on the page, one line each, so a failure names the rule and its first targets. */
async function violations(page: Page): Promise<string[]> {
  const result = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  return (await personFacing(page, result.violations)).map(
    (violation) =>
      `${violation.id} (${violation.nodes.length}): ${violation.nodes
        .slice(0, 3)
        .map((node) => node.target.join(' '))
        .join(' | ')}`,
  );
}

async function sweep(page: Page, routes: string[]): Promise<string[]> {
  const failures: string[] = [];
  for (const route of routes) {
    await page.goto(route);
    await settled(page);
    const found = await violations(page);
    if (found.length > 0) failures.push(`${route}: ${found.join('; ')}`);
  }
  return failures;
}

/** The coach's first client and the owner's first program and meal plan, for the routes that need ids. */
async function coachRoutes(page: Page): Promise<string[]> {
  const [membership] = await memberships(page);
  const tenantId = membership.tenantId;
  const clients = await api<{ id: string }[]>(page, 'GET', '/api/clients', { tenantId });
  expect(clients.status).toBe(200);
  const templates = await api<{ id: string }[]>(page, 'GET', '/api/training/templates', {
    tenantId,
  });
  const plans = await api<{ id: string }[]>(page, 'GET', '/api/nutrition/meal-plans', {
    tenantId,
  });
  const routes = [...COACH_ROUTES];
  const client = clients.body[0]?.id;
  if (client) {
    routes.push(
      `/clients/${client}`,
      `/clients/${client}/training`,
      `/clients/${client}/nutrition`,
      `/clients/${client}/checkins`,
      `/clients/${client}/progress`,
      `/clients/${client}/service`,
      `/clients/${client}/intake`,
    );
  }
  if (templates.status === 200 && templates.body[0]) {
    routes.push(`/training/programs/${templates.body[0].id}`);
  }
  if (plans.status === 200 && plans.body[0]) routes.push(`/nutrition/plans/${plans.body[0].id}`);
  return routes;
}

for (const viewport of VIEWPORTS) {
  test.describe(`axe at ${viewport.name}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test('the coach routes have no WCAG A/AA violations', async ({ page }) => {
      test.setTimeout(420_000);
      await signIn(page, ACCOUNTS.coachLea);
      const routes = await coachRoutes(page);
      expect(await sweep(page, routes)).toEqual([]);
    });

    test('the client routes have no WCAG A/AA violations', async ({ page }) => {
      test.setTimeout(420_000);
      await signIn(page, ACCOUNTS.maya);
      expect(await sweep(page, CLIENT_ROUTES)).toEqual([]);
    });
  });
}
