import AxeBuilder from '@axe-core/playwright';
import { contrast } from '../src/app/core/theme/color';
import {
  expect,
  expectNoHorizontalOverflow,
  json,
  mockSession,
  mockSignedOut,
  test,
  waitForFonts,
} from './support';

const MODES = ['light', 'dark'] as const;
const PRESETS = [
  { id: 'forest', brand: '#153d33' },
  { id: 'navy', brand: '#15233f' },
  { id: 'charcoal', brand: '#221b18' },
  { id: 'plum', brand: '#36203a' },
] as const;

test('the default lab uses TB Gym forest and cream', async ({ page }) => {
  await mockSignedOut(page);
  await page.goto('/dev/ui-lab');
  const colors = await page.locator('app-ui-lab').evaluate((lab) => {
    const button = lab.querySelector('.tb-button--filled')!;
    return {
      button: getComputedStyle(button).backgroundColor,
      background: getComputedStyle(lab).backgroundColor,
    };
  });
  expect(colors).toEqual({ button: 'rgb(21, 61, 51)', background: 'rgb(251, 250, 245)' });
});

async function themeColors(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    const value = (name: string) => root.getPropertyValue(name).trim();
    return {
      brand: value('--tb-brand'),
      onBrand: value('--tb-on-brand'),
      onBrandMuted: value('--tb-on-brand-muted'),
      accent: value('--tb-accent'),
      onAccent: value('--tb-on-accent'),
      accentBright: value('--tb-accent-bright'),
      bg: value('--tb-bg'),
      surface: value('--tb-surface'),
      ink: value('--tb-ink'),
      muted: value('--tb-muted'),
    };
  });
}

for (const preset of PRESETS) {
  for (const mode of MODES) {
    test(`${preset.id} ${mode}: lab and both shells keep AA contrast at phone and desktop widths`, async ({
      page,
    }) => {
      const query = `?brand=${preset.id}&mode=${mode}`;
      await mockSignedOut(page);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`/dev/ui-lab${query}`);
      await expect(page.getByRole('heading', { name: 'UI lab' })).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('data-mode', mode);
      await waitForFonts(page);

      const colors = await themeColors(page);
      expect(colors.brand).toBe(preset.brand);
      expect(contrast(colors.brand, colors.onBrand)).toBeGreaterThanOrEqual(7);
      expect(contrast(colors.brand, colors.onBrandMuted)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(colors.accent, colors.onAccent)).toBeGreaterThanOrEqual(4.5);
      for (const surface of [colors.bg, colors.surface]) {
        expect(contrast(surface, colors.ink)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(surface, colors.muted)).toBeGreaterThanOrEqual(4.5);
      }
      await expectNoHorizontalOverflow(page);
      const labScan = await new AxeBuilder({ page })
        .include('app-ui-lab')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze();
      expect(labScan.violations.map((violation) => violation.id)).toEqual([]);
      await page.screenshot({ path: test.info().outputPath('lab-390.png'), fullPage: true });
      await page.setViewportSize({ width: 1440, height: 900 });
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: test.info().outputPath('lab-1440.png'), fullPage: true });

      await mockSession(page, {
        extra: {
          'GET /api/clients': (route) => json(route, 200, []),
          'GET /api/invitations': (route) => json(route, 200, []),
        },
      });
      await page.goto(`/${query}`);
      await expect(page.locator('app-coach-shell')).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('data-mode', mode);
      await waitForFonts(page);
      await expectNoHorizontalOverflow(page);
      const shellScan = await new AxeBuilder({ page })
        .include('app-coach-shell')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze();
      expect(shellScan.violations.map((violation) => violation.id)).toEqual([]);
      await page.screenshot({ path: test.info().outputPath('shell-1440.png'), fullPage: true });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.getByRole('button', { name: 'Menu', exact: true }).click();
      await expect(page.locator('#coach-navigation-dialog')).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: test.info().outputPath('shell-390.png'), fullPage: true });

      await mockSession(page, {
        memberships: [
          {
            tenantId: '00000000-0000-4000-8000-000000000003',
            tenantName: 'Atlas Performance',
            tenantSlug: 'atlas-performance',
            role: 'Client',
          },
        ],
        extra: {
          'GET /api/client-access/me': (route) => json(route, 200, []),
          'GET /api/client-profile/me/coach': (route) =>
            json(route, 200, { name: 'Hicham Haddad' }),
        },
      });
      await page.goto(`/me${query}`);
      await expect(page.locator('app-client-tabs')).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('data-mode', mode);
      await expectNoHorizontalOverflow(page);
      const clientScan = await new AxeBuilder({ page })
        .include('app-client-tabs')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze();
      expect(clientScan.violations.map((violation) => violation.id)).toEqual([]);
      await page.screenshot({
        path: test.info().outputPath('client-shell-390.png'),
        fullPage: true,
      });
      await page.setViewportSize({ width: 1440, height: 900 });
      await expectNoHorizontalOverflow(page);
      await page.screenshot({
        path: test.info().outputPath('client-shell-1440.png'),
        fullPage: true,
      });
    });
  }
}

test('system mode follows the device and updates legacy aliases in the same scope', async ({
  page,
}) => {
  await mockSignedOut(page);
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/dev/ui-lab?mode=system');
  await expect(page.locator('html')).toHaveAttribute('data-mode', 'system');
  const background = () =>
    page.evaluate(() => {
      const style = getComputedStyle(document.documentElement);
      return [
        style.getPropertyValue('--tb-bg').trim(),
        style.getPropertyValue('--color-background').trim(),
      ];
    });
  await expect.poll(background).toEqual(['#0f1513', '#0f1513']);
  await page.emulateMedia({ colorScheme: 'light' });
  await expect.poll(background).toEqual(['#fbfaf5', '#fbfaf5']);
});
