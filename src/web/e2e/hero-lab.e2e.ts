import AxeBuilder from '@axe-core/playwright';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, expectNoHorizontalOverflow, mockSignedOut, test, waitForFonts } from './support';

async function openHero(page: import('@playwright/test').Page, width: number) {
  await page.setViewportSize({ width, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mockSignedOut(page);
  await page.goto('/dev/ui-lab/hero');
  await expect(page.getByRole('heading', { name: /TB Gym, redesigned/ })).toBeVisible();
  await waitForFonts(page);
}

for (const width of [390, 1440]) {
  test(`prototype hero screens at ${width}px`, async ({ page }) => {
    await openHero(page, width);
    await expect(page.getByRole('region', { name: 'Client Today' })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    const scan = await new AxeBuilder({ page })
      .include('app-hero-lab')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(scan.violations.map((violation) => violation.id)).toEqual([]);
    await expect(page.locator('#phone')).toHaveScreenshot(`client-today-${width}.png`);

    await page.getByRole('button', { name: 'Start workout' }).click();
    await expect(page.getByRole('region', { name: 'Workout player' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Log set 1/ })).toBeVisible();
    const playerScan = await new AxeBuilder({ page })
      .include('app-hero-lab')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(playerScan.violations.map((violation) => violation.id)).toEqual([]);
    await expect(page.locator('#phone')).toHaveScreenshot(`workout-player-${width}.png`);

    await page.getByRole('button', { name: 'Back to Today' }).click();
    await page.getByRole('button', { name: 'Coach app' }).click();
    await expect(page.getByRole('region', { name: 'Coach Today' })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    const coachScan = await new AxeBuilder({ page })
      .include('app-hero-lab')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(coachScan.violations.map((violation) => violation.id)).toEqual([]);
    await expect(page.locator('#desk')).toHaveScreenshot(`coach-today-${width}.png`);
  });
}

test('the lab workout and coach actions update their local preview', async ({ page }) => {
  await openHero(page, 390);
  await page.getByRole('button', { name: 'Start workout' }).click();
  await page.getByRole('button', { name: /Log set 1/ }).click();
  await expect(page.locator('#toast-phone')).toContainText('New PR!');
  await expect(page.getByRole('timer', { name: 'Rest timer' })).toBeVisible();
  await page.getByRole('button', { name: 'Skip' }).click();
  await expect(page.getByRole('timer', { name: 'Rest timer' })).toBeHidden();
  await page.getByRole('button', { name: 'Back to Today' }).click();
  await page.getByRole('button', { name: 'Coach app' }).click();
  await page.getByRole('button', { name: 'Review' }).click();
  await expect(
    page.getByRole('region', { name: 'Needs you' }).getByRole('button', { name: 'Review' }),
  ).toHaveCount(0);
  await expect(page.getByText('4 clients need you')).toBeVisible();
});

test('GSAP plays the PR moment and cleans up its burst', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await mockSignedOut(page);
  await page.goto('/dev/ui-lab/hero');
  await waitForFonts(page);
  await page.getByRole('button', { name: 'Start workout' }).click();
  await expect(page.getByRole('region', { name: 'Workout player' })).toBeVisible();
  await page.getByRole('button', { name: /Log set 1/ }).click();
  await expect.poll(() => page.locator('.burst').count()).toBeGreaterThan(0);
  await expect(page.locator('.burst')).toHaveCount(0, { timeout: 3000 });
});

test('brand, dark mode and enlarged text keep the phone preview within the viewport', async ({
  page,
}) => {
  await openHero(page, 390);
  await page.getByRole('button', { name: 'Cedar Strength: navy and coral' }).click();
  await page.getByRole('button', { name: 'Dark', exact: true }).click();
  await expect(page.locator('#phone')).toHaveAttribute('data-mode', 'dark');
  expect(
    await page
      .locator('#phone')
      .evaluate((phone) => getComputedStyle(phone).getPropertyValue('--brand').trim()),
  ).toBe('#15233f');
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '32px';
  });
  await expectNoHorizontalOverflow(page);
  await expect(page.locator('#phone')).toHaveScreenshot('client-today-390-dark-200-percent.png');
});

for (const width of [390, 1440]) {
  test(`saved prototype reference at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const file = path.resolve(process.cwd(), '../../docs/design/prototype/tb-gym-prototype.html');
    await page.goto(pathToFileURL(file).href);
    await waitForFonts(page);
    await expect(page.locator('#phone')).toHaveScreenshot(`reference-client-today-${width}.png`);
    await page.getByRole('button', { name: 'Start workout' }).click();
    await expect(page.locator('#phone')).toHaveScreenshot(`reference-workout-player-${width}.png`);
    await page.getByRole('button', { name: 'Coach app' }).click();
    await expect(page.locator('#desk')).toHaveScreenshot(`reference-coach-today-${width}.png`);
  });
}
