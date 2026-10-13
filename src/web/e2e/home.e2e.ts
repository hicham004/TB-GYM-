import AxeBuilder from '@axe-core/playwright';
import {
  expect,
  expectNoHorizontalOverflow,
  json,
  mockSignedOut,
  test,
  waitForFonts,
} from './support';

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
    for (const id of ['week', 'inside', 'for-gyms', 'talk']) {
      await expect(page.locator(`#${id}`)).toBeAttached();
    }
    // Talk to us is the way in for gyms: the hero, the gym story and the finale all lead to it.
    expect(await page.locator('a[href="/#talk"]').count()).toBeGreaterThanOrEqual(3);
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

// ---- Talk to us for gyms (UI plan R6.2g) ----

for (const width of [1440, 390]) {
  test(`a gym writes to us from the homepage at ${width}px: the stamp, the form, the thanks`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const posted: unknown[] = [];
    let stamps = 0;
    await mockSignedOut(page, {
      'GET /api/website/contact-form': (route) => {
        stamps++;
        return json(route, 200, { stamp: `stamp-${stamps}` });
      },
      'POST /api/website/contact-requests': (route) => {
        posted.push(route.request().postDataJSON());
        return route.fulfill({ status: 202, body: '' });
      },
    });
    await page.goto('/');
    await waitForFonts(page);
    await expect(page.locator('#week')).toHaveAttribute('data-motion', /running|off/);

    // The hero's quiet link lands on the form; coming into view asks for the stamp.
    await page.locator('.hero__talk').click();
    await expect(page.locator('#talk')).toBeInViewport();
    await expect.poll(() => stamps).toBe(1);
    await expect(page.locator('.talk__whatsapp')).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath('home-talk.png') });
    const accessibility = await new AxeBuilder({ page }).include('#talk').analyze();
    expect(accessibility.violations).toEqual([]);

    await page.getByLabel('Your name', { exact: true }).fill('Rami Tabet');
    await page.getByLabel('Your gym', { exact: true }).fill('Oakline Strength');
    await page.getByLabel('Email or WhatsApp number', { exact: true }).fill('+961 70 123 456');
    await page
      .getByLabel('About your gym (optional)', { exact: true })
      .fill('Six coaches, about 90 clients.');
    await page.getByRole('button', { name: 'Send' }).click();

    await expect(page.getByRole('status')).toContainText('Thanks, Rami Tabet.');
    await expect(page.getByRole('status')).toContainText('+961 70 123 456');
    expect(posted).toEqual([
      {
        name: 'Rami Tabet',
        gymName: 'Oakline Strength',
        contact: '+961 70 123 456',
        message: 'Six coaches, about 90 clients.',
        website: '',
        formStamp: 'stamp-1',
      },
    ]);
    await expect(page.locator('#talk form')).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath('home-talk-sent.png') });
    await expectNoHorizontalOverflow(page);
  });
}

test('the form refuses an empty send with its reasons and keeps the keyboard inside it', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockSignedOut(page, {
    'GET /api/website/contact-form': (route) => json(route, 200, { stamp: 'stamp' }),
  });
  await page.goto('/');
  await waitForFonts(page);

  await page.getByLabel('Your name', { exact: true }).focus();
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Your gym', { exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Email or WhatsApp number', { exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('About your gym (optional)', { exact: true })).toBeFocused();
  // The hidden field is skipped: the next stop is Send.
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Send' })).toBeFocused();
  await page.keyboard.press('Enter');

  const summary = page.locator('#talk-summary');
  await expect(summary).toBeFocused();
  await expect(summary).toContainText("Your message can't be sent yet:");
  await expect(summary).toContainText('Enter your name.');
  await expect(page.getByLabel('Your name', { exact: true })).toHaveAttribute(
    'aria-invalid',
    'true',
  );
  const accessibility = await new AxeBuilder({ page }).include('#talk').analyze();
  expect(accessibility.violations).toEqual([]);
});

test('with a number configured the WhatsApp link appears beside the form, and nowhere else is loaded', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockSignedOut(page, {
    'GET /api/website/settings': (route) =>
      json(route, 200, { whatsAppNumber: '+96170123456', analytics: { script: null } }),
  });
  await page.goto('/');
  await waitForFonts(page);

  const link = page.locator('.talk__whatsapp');
  await expect(link).toHaveAttribute('href', 'https://wa.me/96170123456');
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toHaveAttribute('rel', 'noopener');
  expect(await page.locator('script[data-analytics]').count()).toBe(0);
});

test('analytics loads from this origin only when the deployment names its script, and never before the settings', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const requests: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.origin !== 'http://127.0.0.1:4300') requests.push(url.href);
    if (url.pathname.startsWith('/stats/')) requests.push(url.pathname);
  });
  await page.route('**/stats/pa-e2e.js', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/javascript',
      body: 'window.__plausibleSeen = { endpoint: window.plausible.o.endpoint, queued: window.plausible.q || [] };',
    }),
  );
  await mockSignedOut(page, {
    'GET /api/website/settings': (route) =>
      json(route, 200, { whatsAppNumber: null, analytics: { script: 'pa-e2e.js' } }),
  });
  await page.goto('/');
  await waitForFonts(page);

  const script = page.locator('script[data-analytics]');
  await expect(script).toHaveCount(1);
  await expect(script).toHaveAttribute('src', '/stats/pa-e2e.js');
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { __plausibleSeen?: { endpoint: string } }).__plausibleSeen,
      ),
    )
    .toEqual({ endpoint: '/stats/event', queued: [] });
  // Everything the page asked for came from its own origin; the proxied script is the one /stats/ request.
  expect(requests).toEqual(['/stats/pa-e2e.js']);
});
