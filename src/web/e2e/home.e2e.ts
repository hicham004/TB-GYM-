import AxeBuilder from '@axe-core/playwright';
import { expect, expectNoHorizontalOverflow, mockSignedOut, test, waitForFonts } from './support';

const HEADLINE = /You plan it\./;

/**
 * The page is pre-rendered; `data-motion` leaves `idle` once the app is live and the story has
 * decided whether it is scroll-driven here (`running`) or told by the stylesheet alone (`off`).
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
    for (const id of ['chapters', 'inside', 'who-its-for']) {
      await expect(page.locator(`#${id}`)).toBeAttached();
    }
    await expect(page.locator('.chapter')).toHaveCount(7);
    await expectNoHorizontalOverflow(page);
    await page.screenshot({ path: testInfo.outputPath('home-full.png'), fullPage: true });

    // Reduced motion shows the finished page, so contrast is measured on final colours rather
    // than on a section caught half-way through rising in.
    const accessibility = await new AxeBuilder({ page }).analyze();
    expect(accessibility.violations).toEqual([]);
  });
}

test('on a wide screen the stage of two screens follows the chapters as they scroll past', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await openHome(page);
  const week = page.locator('#week');

  await expect(week).toHaveAttribute('data-motion', 'running');
  await expect(week).toHaveAttribute('data-moment', 'hero');
  await expect(page.locator('.week__stage')).toBeVisible();
  // Each chapter's own pictures stay out of the way while the stage tells the story.
  await expect(page.locator('.chapter .screens').first()).toBeHidden();

  await page.evaluate(() =>
    document.querySelector('[data-chapter="train"]')?.scrollIntoView({ block: 'center' }),
  );
  await expect(week).toHaveAttribute('data-moment', 'train');
  await expect(page.locator('.stage__coach picture.is-active img')).toHaveAttribute(
    'src',
    '/images/home/train-coach.webp',
  );
  await expect(page.locator('.stage__number')).toHaveText(/55 kg × 5/);
  await expect(page.locator('.stage__when')).toHaveText(/Monday evening/);

  await page.evaluate(() =>
    document.querySelector('[data-chapter="progress"]')?.scrollIntoView({ block: 'center' }),
  );
  await expect(week).toHaveAttribute('data-moment', 'progress');
  await expect(page.locator('.stage__days li.is-on')).toHaveText('Sun');

  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(week).toHaveAttribute('data-moment', 'hero');
});

test('reduced motion shows a still, complete story: every chapter with its own two screens', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openHome(page);

  await expect(page.locator('#week')).toHaveAttribute('data-motion', 'off');
  await expect(page.locator('.week__stage')).toBeHidden();
  await expect(page.locator('.chapter .screens')).toHaveCount(7);
  for (const chapter of ['plan', 'share']) {
    const figure = page.locator(`[data-chapter="${chapter}"] .screens`);
    await figure.scrollIntoViewIfNeeded();
    await expect(figure).toBeVisible();
    await expect(figure.locator('.screens__phone img')).toHaveAttribute(
      'src',
      `/images/home/${chapter}-phone.webp`,
    );
  }
  const timed = await page.evaluate(
    () =>
      document.getAnimations().filter((animation) => animation.timeline instanceof DocumentTimeline)
        .length,
  );
  expect(timed).toBe(0);
});

test('a phone gets the stacked story: the hero copy owns the first screen, every chapter has its pictures', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await openHome(page);

  await expect(page.locator('#week')).toHaveAttribute('data-motion', 'off');
  await expect(page.locator('.week__stage')).toBeHidden();
  // The first screen is the headline and the way down; the pictures start below it.
  const figureTop = await page
    .locator('.screens--hero')
    .evaluate((el) => el.getBoundingClientRect().top);
  expect(figureTop).toBeGreaterThan(600);
  await page.getByRole('link', { name: 'See a week of coaching' }).click();
  await expect(page.locator('#chapters')).toBeInViewport();
  await expect(page.locator('[data-chapter="train"] .screens__phone img')).toHaveAttribute(
    'srcset',
    /train-phone-480\.webp 480w/,
  );
});

test('the keyboard reaches the week, the sections and the sign-in screen', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openHome(page);

  await page.getByRole('link', { name: 'See a week of coaching' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#chapters')).toBeInViewport();
  // The stage is decorative and holds nothing to land on; Tab from the hero goes to the chapters' words.
  await expect(page.locator('.week__stage a, .week__stage button')).toHaveCount(0);

  await page.getByRole('link', { name: "What's inside" }).first().focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#inside')).toBeInViewport();

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
  expect(await meta('og:title')).toBe('TB Gym: you plan it, they lift it, you both see it');
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
  await expect(page.getByRole('link', { name: 'Get started', exact: true }).first()).toBeVisible();
});

test('homepage mirrors cleanly in right-to-left layout', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await openHome(page);
  await page.evaluate(() => (document.documentElement.dir = 'rtl'));
  await expectNoHorizontalOverflow(page);
  await expect(page.getByRole('heading', { level: 1, name: HEADLINE })).toBeVisible();
});
