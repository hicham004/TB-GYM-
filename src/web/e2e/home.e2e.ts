import AxeBuilder from '@axe-core/playwright';
import { expect, expectNoHorizontalOverflow, mockSignedOut, test, waitForFonts } from './support';

// The sections below the hero render once the browser is idle (`@defer (on idle)`).
async function openHome(page: import('@playwright/test').Page): Promise<void> {
  await mockSignedOut(page);
  await page.goto('/');
  await waitForFonts(page);
  await expect(page.locator('#tour')).toBeAttached();
}

for (const width of [1440, 390]) {
  test(`signed-out visitor sees the public homepage at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openHome(page);

    await expect(page.getByRole('heading', { level: 1, name: /Stop coaching from/ })).toBeVisible();
    await expect(page.locator('.topbar')).toBeHidden();
    await expect(
      page.getByRole('link', { name: 'Start your coach workspace' }).first(),
    ).toHaveAttribute('href', '/auth/register');
    await expect(page.getByRole('link', { name: 'Sign in', exact: true }).first()).toHaveAttribute(
      'href',
      '/auth/sign-in',
    );
    for (const id of ['tour', 'how-it-works', 'who-its-for']) {
      await expect(page.locator(`#${id}`)).toBeAttached();
    }
    await expectNoHorizontalOverflow(page);
    await page.screenshot({ path: testInfo.outputPath('home-full.png'), fullPage: true });

    // Reduced motion shows the finished page, so contrast is measured on final colours rather
    // than on a section caught half-way through fading in.
    const accessibility = await new AxeBuilder({ page }).analyze();
    expect(accessibility.violations).toEqual([]);
  });
}

test('the hero example plays by itself and can be paused or stepped through', async ({ page }) => {
  await openHome(page);
  const example = page.getByRole('group', { name: 'Example: a week of coaching in TB Gym' });

  await expect(example.getByRole('button', { name: 'Plan', exact: true })).toHaveAttribute(
    'aria-current',
    'step',
  );
  await example.getByRole('button', { name: 'Pause the example' }).click();
  await expect(example.getByRole('button', { name: 'Play the example' })).toBeVisible();

  await example.getByRole('button', { name: 'Reply', exact: true }).click();
  await expect(example.getByRole('button', { name: 'Reply', exact: true })).toHaveAttribute(
    'aria-current',
    'step',
  );
  await expect(example.getByText('You reply in the same place')).toBeVisible();
});

test('the product tour is a keyboard-operable tab set', async ({ page }) => {
  await openHome(page);
  const training = page.getByRole('tab', { name: /Training/ });

  await training.focus();
  await page.keyboard.press('ArrowDown');

  await expect(page.getByRole('tab', { name: /Nutrition/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByRole('tab', { name: /Nutrition/ })).toBeFocused();
  await expect(page.getByRole('tabpanel')).toContainText('Meal plans with real targets');
});

test('reduced motion shows a still, complete page with nothing to pause', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openHome(page);

  await expect(page.getByRole('button', { name: /Pause the/ })).toHaveCount(0);
  const timed = await page.evaluate(
    () =>
      document.getAnimations().filter((animation) => animation.timeline instanceof DocumentTimeline)
        .length,
  );
  expect(timed).toBe(0);
});

test('homepage navigation reaches its sections and the existing sign-in screen', async ({
  page,
}) => {
  await openHome(page);
  await page.getByRole('link', { name: 'Take the tour' }).click();
  await expect(page.locator('#tour')).toBeInViewport();
  await page.getByRole('link', { name: 'Sign in', exact: true }).first().click();
  await expect(page).toHaveURL(/\/auth\/sign-in$/);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});

test('a shared link carries a preview image, title and description', async ({ page, request }) => {
  await mockSignedOut(page);
  await page.goto('/');

  const meta = (property: string) =>
    page.locator(`meta[property="${property}"]`).getAttribute('content');
  expect(await meta('og:title')).toBe('TB Gym: stop coaching from chats and spreadsheets');
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
  await expect(page.getByRole('heading', { level: 1, name: /Stop coaching from/ })).toBeVisible();
});
