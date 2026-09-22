import { expect, test, type Page } from '@playwright/test';
import { json, mockOwnerSession, mockSignedOut } from './support';

/**
 * Global-style regression guard for routes that have not been migrated to the design-system
 * primitives. The foundation is additive — new tokens, opt-in `.tb-*` classes — so these routes
 * must render pixel-identically to their baselines. The baselines were captured at c18903f, before
 * any foundation code existed. When a route is migrated on purpose, update its baseline only after
 * inspecting the new image.
 */
const EXERCISES = {
  total: 3,
  items: [
    exercise('10000000-0000-4000-8000-000000000001', 'Barbell back squat', 'Barbell', 'Squat'),
    exercise('10000000-0000-4000-8000-000000000002', 'Cable face pull', 'Cable', 'HorizontalPull'),
    exercise('10000000-0000-4000-8000-000000000003', 'Farmer carry', 'Dumbbell', 'Carry'),
  ],
};

function exercise(id: string, name: string, equipment: string, movementPattern: string) {
  return {
    id,
    name,
    instructions: null,
    equipment,
    movementPattern,
    classification: 'Strength',
    isArchived: false,
    muscles: [{ muscle: 'Quadriceps', role: 'Primary' }],
    tags: ['compound'],
    alternatives: [],
    mediaAssetIds: [],
    version: 1,
  };
}

const ROUTES: {
  name: string;
  path: string;
  ready: string;
  arrange: (page: Page) => Promise<void>;
}[] = [
  { name: 'sign-in', path: '/auth/sign-in', ready: 'h1', arrange: mockSignedOut },
  { name: 'coach-registration', path: '/auth/register', ready: 'h1', arrange: mockSignedOut },
  {
    name: 'exercise-library',
    path: '/training/exercises',
    ready: 'text=Barbell back squat',
    arrange: (page) =>
      mockOwnerSession(page, {
        'GET /api/exercises': (route) => json(route, 200, EXERCISES),
        'GET /api/media': (route) => json(route, 200, { total: 0, skip: 0, take: 100, items: [] }),
      }),
  },
];

for (const width of [1440, 390]) {
  for (const route of ROUTES) {
    test(`${route.name} at ${width}px is unchanged`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await route.arrange(page);
      await page.goto(route.path);
      await expect(page.locator(route.ready).first()).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      await expect(page).toHaveScreenshot(`${route.name}-${width}.png`, { fullPage: true });
    });
  }
}
