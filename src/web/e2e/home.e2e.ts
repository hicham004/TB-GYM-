import AxeBuilder from '@axe-core/playwright';
import { expect, expectNoHorizontalOverflow, mockSignedOut, test, waitForFonts } from './support';

const HEADLINE = /Coach both/;

/**
 * The page is pre-rendered; `data-motion` leaves `idle` once the app is live and the page has
 * decided whether its story moves here (`running`) or is told by the stylesheet alone (`off`).
 */
async function openHome(page: import('@playwright/test').Page): Promise<void> {
  await mockSignedOut(page);
  await page.goto('/');
  await waitForFonts(page);
  await expect(page.locator('#week')).toHaveAttribute('data-motion', /running|off/);
}

for (const width of [1440, 390]) {
  test(`signed-out visitor sees the public homepage at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openHome(page);

    await expect(page.getByRole('heading', { level: 1, name: HEADLINE })).toBeVisible();
    await expect(page.locator('.topbar')).toBeHidden();
    await expect(
      page.getByRole('link', { name: 'Start your coaching space' }).first(),
    ).toHaveAttribute('href', '/auth/register');
    await expect(page.getByRole('link', { name: 'Sign in', exact: true }).first()).toHaveAttribute(
      'href',
      '/auth/sign-in',
    );
    for (const id of ['week', 'inside', 'for-gyms']) {
      await expect(page.locator(`#${id}`)).toBeAttached();
    }
    await expect(page.locator('.stage')).toHaveCount(4);
    await expect(page.locator('.row')).toHaveCount(6);
    // One caption per picture group, and never a quote, a rating or an outcome on a sample person.
    expect(await page.getByText('Shown with sample data').count()).toBeGreaterThanOrEqual(8);
    await expectNoHorizontalOverflow(page);
    await page.screenshot({ path: testInfo.outputPath('home-full.png'), fullPage: true });

    // Reduced motion shows the finished page, so contrast is measured on final colours rather
    // than on a headline caught half-way through rising in.
    const accessibility = await new AxeBuilder({ page }).analyze();
    expect(accessibility.violations).toEqual([]);
  });

  test(`what changed is a page of its own at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await mockSignedOut(page);
    await page.goto('/changelog');
    await waitForFonts(page);

    await expect(page.getByRole('heading', { level: 1, name: 'What changed' })).toBeVisible();
    expect(await page.locator('time[datetime]').count()).toBeGreaterThan(0);
    await expect(page.locator('.changelog__lead')).toHaveText(/Last change \d{1,2} \w{3} \d{4}\./);
    await expectNoHorizontalOverflow(page);
    await page.screenshot({ path: testInfo.outputPath('changelog-full.png'), fullPage: true });
    const accessibility = await new AxeBuilder({ page }).analyze();
    expect(accessibility.violations).toEqual([]);
  });
}

test('on a wide screen the panel follows the stages as they scroll past, and the header takes the tone under it', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await openHome(page);
  const week = page.locator('#week');
  const panel = page.locator('.week__panel');

  await expect(week).toHaveAttribute('data-motion', 'running');
  await expect(week).toHaveAttribute('data-stage', 'plan');
  await expect(panel).toBeVisible();
  await expect(panel).toHaveAttribute('data-stage', 'plan');
  await expect(page.locator('.header')).toHaveAttribute('data-tone', 'dark');
  // Each stage's own pictures stay out of the way while the panel tells the story.
  await expect(page.locator('.stage__own').first()).toBeHidden();

  await page.evaluate(() =>
    document.querySelector('[data-stage-id="checkin"]')?.scrollIntoView({ block: 'center' }),
  );
  await expect(week).toHaveAttribute('data-stage', 'checkin');
  await expect(panel).toHaveAttribute('data-stage', 'checkin');
  await expect(page.locator('.days--strip .days__day.is-on')).toHaveText('Thu');
  await expect(page.locator('.header')).toHaveAttribute('data-tone', 'light');

  await page.evaluate(() =>
    document.querySelector('[data-stage-id="see"]')?.scrollIntoView({ block: 'center' }),
  );
  await expect(week).toHaveAttribute('data-stage', 'see');
  await expect(page.locator('.days--strip .days__day.is-on')).toHaveText('Sun');

  // The finale is shorter than the screen, so it never rises up to the header on this viewport;
  // back at the top the hero is under the header again.
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(week).toHaveAttribute('data-stage', 'plan');
  await expect(page.locator('.header')).toHaveAttribute('data-tone', 'dark');
});

test('reduced motion shows a still, complete week: every stage with its own two screens', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openHome(page);

  await expect(page.locator('#week')).toHaveAttribute('data-motion', 'off');
  await expect(page.locator('.week__panel')).toBeHidden();
  for (const stage of ['plan', 'see']) {
    const figure = page.locator(`[data-stage-id="${stage}"] .stage__own`);
    await figure.scrollIntoViewIfNeeded();
    await expect(figure).toBeVisible();
    await expect(figure.locator('.stage__own-phone img')).toBeVisible();
    await expect(figure.locator('.stage__own-window img')).toBeVisible();
  }
  await expect(page.locator('[data-stage-id="see"] .stage__own-phone img')).toHaveAttribute(
    'src',
    '/images/home/client-progress-760.webp',
  );
  const timed = await page.evaluate(
    () =>
      document.getAnimations().filter((animation) => animation.timeline instanceof DocumentTimeline)
        .length,
  );
  expect(timed).toBe(0);
});

test('a phone gets the stacked page: the hero copy owns the first screen, every stage has one asset, the menu opens the sections', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await openHome(page);

  await expect(page.locator('#week')).toHaveAttribute('data-motion', 'off');
  await expect(page.locator('.week__panel')).toBeHidden();
  // The first screen is the headline and the way in; the phone picture starts below it.
  const figureTop = await page
    .locator('.hero__media')
    .evaluate((el) => el.getBoundingClientRect().top);
  expect(figureTop).toBeGreaterThan(600);
  await expect(page.locator('.hero__window')).toBeHidden();
  await expect(page.locator('[data-stage-id="train"] .stage__own-phone')).toBeAttached();
  await expect(page.locator('[data-stage-id="train"] .stage__own-window')).toBeHidden();
  // A feature row's window is the narrower crop of the same screen.
  const narrow = page.locator('[data-row="programs"] .pair__window img');
  await narrow.scrollIntoViewIfNeeded();
  await expect
    .poll(() => narrow.evaluate((img: HTMLImageElement) => img.currentSrc))
    .toMatch(/programs-narrow/);

  const menu = page.getByRole('button', { name: 'Menu' });
  await menu.click();
  await expect(page.getByRole('button', { name: 'Close' })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  await expect(page.locator('#home-menu')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#home-menu')).toBeHidden();
  await menu.click();
  await page.locator('#home-menu').getByRole('link', { name: 'For gyms' }).click();
  await expect(page.locator('#home-menu')).toBeHidden();
  await expect(page.locator('#for-gyms')).toBeInViewport();
});

test('the keyboard reaches the week, the sections, what changed and the sign-in screen', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openHome(page);

  await page.getByRole('link', { name: 'The week' }).first().focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#week')).toBeInViewport();
  // The panel is decorative and holds nothing to land on.
  await expect(page.locator('.week__panel a, .week__panel button')).toHaveCount(0);

  await page.getByRole('link', { name: "What's inside" }).first().focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#inside')).toBeInViewport();

  await page
    .getByRole('link', { name: /What changed/ })
    .first()
    .focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/changelog$/);
  await expect(page.getByRole('heading', { level: 1, name: 'What changed' })).toBeVisible();

  await page.getByRole('link', { name: 'Sign in', exact: true }).first().focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/auth\/sign-in$/);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});

test('a shared link carries a preview image, title and description', async ({ page, request }) => {
  await mockSignedOut(page);
  await page.goto('/');

  const meta = (property: string) =>
    page.locator(`meta[property="${property}"]`).getAttribute('content');
  expect(await meta('og:title')).toBe('TB Gym: coach both sides of the week');
  expect(await meta('og:description')).toBeTruthy();
  const image = await request.get((await meta('og:image')) ?? '');
  expect(image.status()).toBe(200);
  // WhatsApp silently drops previews over 300 kB.
  expect((await image.body()).length).toBeLessThan(300 * 1024);
});

test('homepage reflows at 200% text on a narrow screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await openHome(page);
  await page.evaluate(() => (document.documentElement.style.fontSize = '32px'));
  await expectNoHorizontalOverflow(page);
  await expect(page.getByRole('link', { name: 'Start your coaching space' }).first()).toBeVisible();
});

test('homepage mirrors cleanly in right-to-left layout', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await openHome(page);
  await page.evaluate(() => (document.documentElement.dir = 'rtl'));
  await expectNoHorizontalOverflow(page);
  await expect(page.getByRole('heading', { level: 1, name: HEADLINE })).toBeVisible();
});
