import AxeBuilder from '@axe-core/playwright';
import type { Locator } from '@playwright/test';
import { expect, expectNoHorizontalOverflow, mockSignedOut, test, waitForFonts } from '../support';

/**
 * The private pre-launch build (UI plan R6.2h), served by `scripts/private-preview.mjs` from the
 * stand-ins in `placeholders/`: every response marked noindex, every page saying so, and the
 * stand-ins drawn where the shoot's photographs will go, each with its visible mark, as the
 * photograph when the folder holds the file and as the grey stand-in when it does not.
 */
const HEADLINE = /Coach both/;

/** The stand-ins, by the attribute the piece marks its host with and the file each is kept as. */
const STAND_INS = [
  ['hero', 'hero.jpg'],
  ['train', 'train.jpg'],
  ['talk', 'talk.jpg'],
  ['team', 'team.jpg'],
] as const;

/** A drawn stand-in: its mark, and either the photograph loaded or the grey hatch with its note. */
async function expectStandIn(standIn: Locator, file: string): Promise<void> {
  await standIn.scrollIntoViewIfNeeded();
  await expect(standIn.locator('.mark').first()).toHaveText(`Placeholder · ${file}`);
  const photo = standIn.locator('img');
  if ((await photo.count()) > 0) {
    await expect(photo).toHaveAttribute('src', `/placeholders/${file}`);
    await expect
      .poll(() => photo.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0))
      .toBe(true);
    await expect(standIn.locator('.mark--missing')).toHaveCount(0);
  } else {
    await expect(standIn.locator('.missing')).toBeVisible();
    await expect(standIn.locator('.mark--missing')).toHaveText(
      'Not in the placeholders folder yet',
    );
  }
}

test('every response is marked noindex, and the pages say so themselves', async ({ request }) => {
  for (const path of ['/', '/changelog', '/auth/sign-in', '/images/home/client-today-760.webp']) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(200);
    expect(response.headers()['x-robots-tag'], path).toBe('noindex, nofollow');
  }
  for (const path of ['/', '/changelog']) {
    const html = await (await request.get(path)).text();
    expect(html, path).toMatch(/<meta name="robots" content="noindex, nofollow">/);
    expect(html, path).toMatch(/<h1[\s>]/);
  }
  // The homepage arrives with its stand-ins drawn, marked, as finished HTML.
  const home = await (await request.get('/')).text();
  expect(home.match(/\sdata-placeholder="hero"/g)).toHaveLength(1);
  expect(home).toMatch(/Placeholder · hero\.jpg/);
  expect(home).not.toMatch(/<app-home-window[^>]*class="hero__window"/);
  // Nor is the window's picture asked for ahead of a page that never draws it.
  expect(home).not.toMatch(/<link[^>]*rel="preload"[^>]*today-needs-you-dark/);
  expect(home).toMatch(/<link[^>]*rel="preload"[^>]*client-today-460\.avif/);
  // Without an API behind it, the page still gets a visitor's answers.
  expect((await request.get('/api/auth/me')).status()).toBe(401);
  expect(await (await request.get('/api/website/settings')).json()).toEqual({
    whatsAppNumber: null,
    analytics: { script: null },
  });
  expect((await request.get('/api/website/contact-form')).status()).toBe(404);
});

for (const width of [1440, 390]) {
  test(`the still private homepage at ${width}px draws the four stand-ins, each with its mark`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await mockSignedOut(page);
    await page.goto('/');
    await waitForFonts(page);
    await expect(page.locator('#week')).toHaveAttribute('data-motion', 'off');

    await expect(page.getByRole('heading', { level: 1, name: HEADLINE })).toBeVisible();
    // The hero: the photograph behind the copy, the phone in front, and no coach's window.
    const hero = page.locator('.hero__photo');
    await expect(hero).toBeVisible();
    await expect(hero.locator('img')).toHaveAttribute('fetchpriority', 'high');
    await expect(page.locator('.hero__window')).toHaveCount(0);
    await expect(page.locator('.hero__phone img')).toBeVisible();
    // Monday evening and Sunday carry a photograph; Monday and Thursday keep their screens alone.
    await expect(page.locator('[data-stage-id="train"] .stage__own-photo')).toBeAttached();
    await expect(page.locator('[data-stage-id="see"] .stage__own-photo')).toBeAttached();
    await expect(page.locator('[data-stage-id="plan"] .stage__own-photo')).toHaveCount(0);
    await expect(page.locator('[data-stage-id="checkin"] .stage__own-photo')).toHaveCount(0);
    for (const [name, file] of STAND_INS) {
      await expectStandIn(page.locator(`[data-placeholder="${name}"]:visible`).first(), file);
    }
    await expect(page.locator('.story__photo')).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await page.screenshot({ path: testInfo.outputPath('private-home-full.png'), fullPage: true });

    const accessibility = await new AxeBuilder({ page }).analyze();
    expect(accessibility.violations).toEqual([]);
  });
}

test('on a wide screen the panel crossfades to the stage’s photograph and the coach’s window gives way', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await mockSignedOut(page);
  await page.goto('/');
  await waitForFonts(page);
  await expect(page.locator('#week')).toHaveAttribute('data-motion', 'running');
  const panel = page.locator('.week__panel');
  const trainPhoto = panel.locator('[data-placeholder="train"]');
  const windowSlot = panel.locator('.panel__slot--window');

  // Monday: no photograph, the builder's window in view.
  await expect(panel).toHaveAttribute('data-stage', 'plan');
  await expect(panel.locator('[data-placeholder]')).toHaveCount(2);
  await expect(trainPhoto).toHaveCSS('opacity', '0');
  await expect(windowSlot).toHaveCSS('opacity', '1');

  await page.evaluate(() =>
    document.querySelector('[data-stage-id="train"]')?.scrollIntoView({ block: 'center' }),
  );
  await expect(panel).toHaveAttribute('data-stage', 'train');
  await expect(trainPhoto).toHaveCSS('opacity', '1');
  await expect(windowSlot).toHaveCSS('opacity', '0');
  await expect(trainPhoto.locator('.mark')).toHaveText('Placeholder · train.jpg');
  await page.screenshot({ path: testInfo.outputPath('private-train-1440.png') });

  await page.evaluate(() =>
    document.querySelector('[data-stage-id="checkin"]')?.scrollIntoView({ block: 'center' }),
  );
  await expect(panel).toHaveAttribute('data-stage', 'checkin');
  await expect(trainPhoto).toHaveCSS('opacity', '0');
  await expect(windowSlot).toHaveCSS('opacity', '1');

  await page.evaluate(() =>
    document.querySelector('[data-stage-id="see"]')?.scrollIntoView({ block: 'center' }),
  );
  await expect(panel).toHaveAttribute('data-stage', 'see');
  await expect(panel.locator('[data-placeholder="talk"]')).toHaveCSS('opacity', '1');
  await expect(windowSlot).toHaveCSS('opacity', '0');
});

test('what changed keeps the website around it and its noindex tag', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockSignedOut(page);
  await page.goto('/changelog');
  await waitForFonts(page);

  await expect(page.getByRole('heading', { level: 1, name: 'What changed' })).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow');
  await page.getByRole('link', { name: 'Home' }).click();
  await expect(page.getByRole('heading', { level: 1, name: HEADLINE })).toBeVisible();
  await expect(page.locator('.hero__photo')).toBeVisible();
});
