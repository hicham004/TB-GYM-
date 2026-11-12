import AxeBuilder from '@axe-core/playwright';
import type { Page, Route } from '@playwright/test';
import { clientListView } from '../src/testing/client-list-fixtures';
import { COACH_NOW, emptyCoachTodayView, OWNER_ID } from '../src/testing/coach-today-fixtures';
import {
  expect,
  expectNoHorizontalOverflow,
  json,
  mockSession,
  mockSignedOut,
  OWNER_MEMBERSHIP,
  SIGNED_IN_USER,
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
    // At its own address the page is as it was before it also opened at /about (notes plan N2):
    // its links lead to `/`, none to /about, and it asks no search engine to leave it out.
    await expect(page.locator('a.brand')).toHaveAttribute('href', '/');
    await expect(page.locator('.skip-link')).toHaveAttribute('href', '#home-content');
    for (const section of ['week', 'inside', 'for-gyms']) {
      // The wide header's link and the phone menu's.
      await expect(page.locator(`a[href="/#${section}"]`)).toHaveCount(2);
    }
    await expect(page.locator('a[href="/#talk"]')).toHaveCount(3);
    await expect(page.locator('a[href^="/about"]')).toHaveCount(0);
    await expect(page.locator('a[href="/auth/register"]')).toHaveCount(10);
    await expect(page.locator('a[href="/auth/sign-in"]')).toHaveCount(4);
    await expect(page.getByText('Back to Today')).toHaveCount(0);
    await expect(page.locator('meta[name="robots"]')).toHaveCount(0);
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

/**
 * Notes plan N9a2: people with no coach now sign up on TB Gym's own page, so the facts no longer say no
 * client comes from a public sign-up, and the homepage gains no link to that page, at `/` or at `/about`.
 */
test('the facts say clients join by their coach’s invitation, and neither the homepage nor /about links to /train', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openHome(page);

  const fact = page.locator('.facts__list li', { hasText: 'Clients join' });
  await expect(fact).toHaveText('Clients join by invitation from their coach.');
  await expect(page.getByText('never from a public sign-up')).toHaveCount(0);
  await expect(page.locator('a[href^="/train"]')).toHaveCount(0);

  await page.goto('/about');
  await waitForFonts(page);
  await expect(page.getByRole('heading', { level: 1, name: HEADLINE })).toBeVisible();
  await expect(page.locator('.facts__list li', { hasText: 'Clients join' })).toHaveText(
    'Clients join by invitation from their coach.',
  );
  await expect(page.locator('a[href^="/train"]')).toHaveCount(0);
});

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

  // Back at the top the hero is under the header again, and it is clear.
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(week).toHaveAttribute('data-stage', 'plan');
  await expect(page.locator('.header')).toHaveAttribute('data-tone', 'dark');

  // From who it's for to the page's end the page is dark, and the header firms up in the night's
  // colour over it.
  for (const id of ['for-gyms', 'talk']) {
    await page.evaluate((section) => document.getElementById(section)?.scrollIntoView(), id);
    await expect(page.locator('.header')).toHaveAttribute('data-tone', 'night');
  }
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
  // Below the week nothing waits for an entrance (R6.2k): a far row, the facts and who it's for's
  // screens are all there, and the closing line is whole, never split into words.
  await expect(page.locator('[data-row="progress"] .pair__window')).toHaveCSS('opacity', '1');
  await expect(page.locator('.half__shot').first()).toHaveCSS('opacity', '1');
  await expect(page.locator('.finale__title')).not.toHaveAttribute('aria-label');
  const timed = await page.evaluate(
    () =>
      document.getAnimations().filter((animation) => animation.timeline instanceof DocumentTimeline)
        .length,
  );
  expect(timed).toBe(0);
});

test('below the week on a wide screen, the rows arrive, the closing line rises word by word, the pill leans toward a mouse, and the header marks the part in view', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await openHome(page);
  await expect(page.locator('#week')).toHaveAttribute('data-motion', 'running');
  const current = page.locator('.links .is-current');
  const marker = page.locator('.links__marker');
  // Over the hero no link is marked.
  await expect(current).toHaveCount(0);
  await expect(marker).not.toHaveClass(/links__marker--on/);

  // A row still below the screen holds its screens aside; scrolled to, they arrive and settle with
  // nothing left inline, so the stylesheet's own layout holds again.
  const row = page.locator('[data-row="messages"]');
  const window = row.locator('.pair__window');
  await expect(window).toHaveCSS('opacity', '0');
  await row.evaluate((element) => element.scrollIntoView({ block: 'center' }));
  await expect(window).toHaveCSS('opacity', '1');
  await expect(window).toHaveCSS('transform', 'none');
  await expect(row.locator('.pair__phone')).toHaveCSS('transform', 'none');
  await expect(current).toHaveText("What's inside");
  await expect(marker).toHaveClass(/links__marker--on/);

  await page.evaluate(() => document.getElementById('for-gyms')?.scrollIntoView());
  await expect(current).toHaveText('For gyms');
  await expect(page.locator('.half__shot').last()).toHaveCSS('opacity', '1');

  // The closing line is split into words for the eye and read whole by a screen reader.
  const title = page.locator('.finale__title');
  await title.evaluate((element) => element.scrollIntoView({ block: 'center' }));
  await expect(title).toHaveAttribute(
    'aria-label',
    /^\s*Your next client's week starts here\.\s*$/,
  );
  await expect(current).toHaveCount(0);
  const pill = page.locator('.finale__start');
  await expect(pill).toHaveCSS('opacity', '1');
  const box = (await pill.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 30, { steps: 6 });
  await expect(page.locator('.finale__magnet')).not.toHaveCSS('transform', 'none');
  await expect(page.locator('.finale__glow')).not.toHaveCSS('transform', 'none');
});

test('on a short laptop window the panel’s caption sits on its own strip, with no screen drawn over it', async ({
  page,
}) => {
  // The owner's laptop: 1536 px wide, about 730 px tall in the browser, where the panel is short
  // and Sunday's maxes run down under its caption.
  await page.setViewportSize({ width: 1536, height: 730 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await openHome(page);
  await page.evaluate(() =>
    document.querySelector('[data-stage-id="see"]')?.scrollIntoView({ block: 'center' }),
  );
  await expect(page.locator('.week__panel')).toHaveAttribute('data-stage', 'see');

  const strip = await page.evaluate(() => {
    const panel = document.querySelector('.week__panel')!.getBoundingClientRect();
    const caption = document.querySelector('.panel__caption')!;
    const box = caption.getBoundingClientRect();
    // Just past the caption's words, where the maxes window's button used to show through.
    const range = document.createRange();
    range.selectNodeContents(caption);
    const words = range.getBoundingClientRect();
    const hit = document.elementFromPoint(words.right + 12, words.top + words.height / 2);
    return {
      // Inside the panel's 1 px border, the strip spans its whole foot.
      edges: [box.left - panel.left, panel.right - box.right, panel.bottom - box.bottom].map(
        (gap) => Math.round(gap),
      ),
      onTop: hit === caption,
    };
  });
  expect(strip).toEqual({ edges: [1, 1, 1], onTop: true });
});

test('every phone picture is clear past the frame’s corners, where the screen’s square corners once showed', async ({
  page,
}) => {
  await mockSignedOut(page);
  await page.goto('/');
  const phones = [
    'client-today',
    'client-training',
    'client-player',
    'client-checkin',
    'client-checkins',
    'client-finish',
    'client-messages',
    'client-nutrition',
    'client-progress',
  ];
  const corners = await page.evaluate(async (names) => {
    const found: Record<string, number[]> = {};
    for (const name of names) {
      for (const format of ['avif', 'webp']) {
        const image = new Image();
        image.src = `/images/home/${name}-460.${format}`;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext('2d', { willReadFrequently: true })!;
        context.drawImage(image, 0, 0);
        const alpha = (x: number, y: number) => context.getImageData(x, y, 1, 1).data[3];
        // The screen window's corners (Apple's frame at 460 px) lie outside the frame's round ones.
        found[`${name}.${format}`] = [
          alpha(26, 25),
          alpha(433, 25),
          alpha(26, 914),
          alpha(433, 914),
          alpha(230, 470),
        ];
      }
    }
    return found;
  }, phones);

  expect(Object.keys(corners)).toHaveLength(18);
  for (const [picture, [topLeft, topRight, bottomLeft, bottomRight, middle]] of Object.entries(
    corners,
  )) {
    expect([topLeft, topRight, bottomLeft, bottomRight], picture).toEqual([0, 0, 0, 0]);
    expect(middle, picture).toBe(255);
  }
});

for (const width of [1280, 1440]) {
  test(`no picture runs past the page’s edge or shows beside a phone’s edge at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await openHome(page);

    const pictures = await page.evaluate(() => {
      const contentEdge = (element: Element) =>
        element.getBoundingClientRect().right - parseFloat(getComputedStyle(element).paddingRight);
      // Where a window rests: a row below the screen holds its window aside until it arrives (R6.2k).
      const restingRight = (element: Element) => {
        const shift = getComputedStyle(element).transform;
        const x = shift === 'none' ? 0 : new DOMMatrixReadOnly(shift).m41;
        return element.getBoundingClientRect().right - x;
      };
      // What a visitor points at just inside a phone's right edge is never the window under it.
      // The point has to be on screen, so each picture is scrolled into view first.
      const besidePhone = (phone: Element, window: Element) => {
        phone.scrollIntoView({ block: 'center' });
        const box = phone.getBoundingClientRect();
        return document
          .elementsFromPoint(box.right - 3, box.top + 300)
          .some((hit) => window.contains(hit));
      };
      const hero = besidePhone(
        document.querySelector('.hero__phone')!,
        document.querySelector('.hero__window')!,
      );
      const rows = [...document.querySelectorAll('.row')].map((row) => ({
        row: (row as HTMLElement).dataset['row'],
        past:
          restingRight(row.querySelector('.pair__window')!) - contentEdge(row.closest('.rows')!),
        besidePhone: row.classList.contains('row--phone-first')
          ? false
          : besidePhone(row.querySelector('.pair__phone')!, row.querySelector('.pair__window')!),
      }));
      return { rows, hero };
    });

    expect(pictures.hero, 'the hero’s window shows beside the phone').toBe(false);

    // Who it's for: each screen whole inside its half of the band, at its own size from 1440 px.
    const halves = await page.evaluate(() =>
      [...document.querySelectorAll('.half')].map((half) => {
        const box = half.getBoundingClientRect();
        const style = getComputedStyle(half);
        const screen = half.querySelector('.half__window img')!.getBoundingClientRect();
        return {
          name: half.querySelector('h3')!.textContent!.trim(),
          left: screen.left - (box.left + parseFloat(style.paddingLeft)),
          right: box.right - parseFloat(style.paddingRight) - screen.right,
          width: Math.round(screen.width),
        };
      }),
    );
    expect(halves).toHaveLength(2);
    for (const { name, left, right } of halves) {
      expect(left, `${name} starts outside its half`).toBeGreaterThanOrEqual(-1);
      expect(right, `${name} runs past its half`).toBeGreaterThanOrEqual(-1);
    }
    if (width === 1440) expect(halves.map((half) => half.width)).toEqual([520, 640]);
    for (const { row, past, besidePhone } of pictures.rows) {
      expect(past, `${row} runs past the page`).toBeLessThanOrEqual(1);
      expect(besidePhone, `${row} shows beside the phone`).toBe(false);
    }

    // Thursday's review, the widest window in the week, ends inside the phone's right edge too,
    // once the panel has moved its two screens into Thursday's places.
    await page.evaluate(() =>
      document.querySelector('[data-stage-id="checkin"]')?.scrollIntoView({ block: 'center' }),
    );
    await expect(page.locator('.week__panel')).toHaveAttribute('data-stage', 'checkin');
    await expect
      .poll(() =>
        page.evaluate(() => {
          const slot = document.querySelector('.panel__slot--window')!.getBoundingClientRect();
          const phone = document.querySelector('.panel__slot--phone')!.getBoundingClientRect();
          return slot.right - (phone.right - 16);
        }),
      )
      .toBeLessThanOrEqual(0);
  });
}

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
  // So are who it's for's two screens.
  for (const [half, crop] of [
    ['coach', /builder-week-narrow/],
    ['gym', /team-window-narrow/],
  ] as const) {
    const screen = page.locator(`.half--${half} .half__window img`);
    await screen.scrollIntoViewIfNeeded();
    await expect
      .poll(() => screen.evaluate((img: HTMLImageElement) => img.currentSrc))
      .toMatch(crop);
  }

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

test('on a wide screen Send folds into a check, then the thanks takes the form’s place and the finale stays put', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await mockSignedOut(page, {
    'GET /api/website/contact-form': (route) => json(route, 200, { stamp: 'stamp' }),
    'POST /api/website/contact-requests': (route) => route.fulfill({ status: 202, body: '' }),
  });
  await page.goto('/');
  await waitForFonts(page);
  await expect(page.locator('#week')).toHaveAttribute('data-motion', 'running');

  await page.locator('#talk').scrollIntoViewIfNeeded();
  const name = page.getByLabel('Your name', { exact: true });
  const label = page.locator('label[for="talk-name"]');
  // A resting label sits inside its line; in use, it floats above it.
  const resting = await label.boundingBox();
  await name.fill('Rami Tabet');
  await expect.poll(async () => (await label.boundingBox())!.y).toBeLessThan(resting!.y - 12);
  await page.getByLabel('Your gym', { exact: true }).fill('Oakline Strength');
  await page.getByLabel('Email or WhatsApp number', { exact: true }).fill('rami@example.com');
  const finaleTop = () =>
    page.evaluate(() => document.querySelector('.finale')!.getBoundingClientRect().top + scrollY);
  const before = await finaleTop();

  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.locator('.talk__send')).toHaveClass(/talk__send--sent/);
  await expect(page.locator('.talk__send')).toHaveAccessibleName('Sent');
  await page.screenshot({ path: testInfo.outputPath('home-talk-check.png') });
  await expect(page.getByRole('status')).toContainText('Thanks, Rami Tabet.');
  await expect(page.locator('#talk form')).toHaveCount(0);
  expect(Math.abs((await finaleTop()) - before)).toBeLessThanOrEqual(1);
});

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

/**
 * A stand-in for Plausible's site script, doing what its code does in the ways the counting rule
 * depends on (notes plan N1): it reads the stub's options (`o`), then replays its queue (`q`); unless
 * told `autoCapturePageviews: false` it counts the page at once and on every address change the app
 * makes; every event goes through `transformRequest`, and a page view it drops ends the time on page;
 * that time (`engagement`) skips `transformRequest` and goes out for the last page counted when the
 * tab is hidden or loses focus and before the next page view. It always sends that time, where the
 * real script waits for three seconds or a scroll. It notes every call and every event it sends.
 */
const PLAUSIBLE_STAND_IN = `(() => {
  const stub = window.plausible || {};
  const options = stub.o;
  if (!options) return;
  const queued = (stub.q || []).map((args) => Array.from(args));
  window.__plausibleSeen = {
    endpoint: options.endpoint,
    autoCapturePageviews: options.autoCapturePageviews,
    outboundLinks: options.outboundLinks,
    fileDownloads: options.fileDownloads,
    formSubmissions: options.formSubmissions,
    logging: options.logging,
    transformRequest: typeof options.transformRequest,
    queued,
  };
  const calls = (window.__plausibleCalls = []);
  const sent = (window.__plausibleSent = []);
  let counted = null;
  let ignored = false;
  const send = (payload) => {
    sent.push({ n: payload.n, u: new URL(payload.u).pathname, on: location.pathname });
    fetch(options.endpoint, { method: 'POST', body: JSON.stringify(payload), keepalive: true });
  };
  const engagement = () => {
    if (counted !== null && !ignored) send({ n: 'engagement', u: counted });
  };
  const track = (name, extra) => {
    calls.push([name, extra || null]);
    if (name === 'pageview') engagement();
    let payload = { n: name, u: (extra && (extra.u || extra.url)) || location.href, r: document.referrer || null };
    if (typeof options.transformRequest === 'function') payload = options.transformRequest(payload);
    if (!payload) {
      if (name === 'pageview') ignored = true;
      return;
    }
    if (name === 'pageview') {
      counted = payload.u;
      ignored = false;
    }
    send(payload);
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') engagement();
  });
  window.addEventListener('blur', engagement);
  if (options.autoCapturePageviews !== false) {
    const pushState = history.pushState;
    history.pushState = function () {
      pushState.apply(this, arguments);
      track('pageview');
    };
    window.addEventListener('popstate', () => track('pageview'));
    track('pageview');
  }
  for (const args of queued) track(...args);
  window.plausible = track;
})();`;

const ANALYTICS_ON = { whatsAppNumber: null, analytics: { script: 'pa-e2e.js' } };

interface PlausibleSeen {
  readonly __plausibleSeen?: Record<string, unknown>;
  readonly __plausibleCalls?: unknown[][];
  readonly __plausibleSent?: { n: string; u: string; on: string }[];
}

/** The origin this run's pages are served from: the dev server's, on whichever port the config names. */
const ownOrigin = () => new URL(test.info().project.use.baseURL ?? 'http://127.0.0.1:4300').origin;

/**
 * Plausible's script and events on this origin, as nginx serves them: the stand-in above at
 * /stats/pa-e2e.js and an endpoint that takes every event. Notes every /stats/ request, every
 * request to another origin, every read of the website's settings, and every event as it reached
 * the endpoint, with the address it carried whole (`events`).
 */
async function serveAnalytics(page: Page) {
  const origin = ownOrigin();
  const requests: string[] = [];
  const settingsReads: string[] = [];
  const events: { n: string; u: string }[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.origin !== origin) requests.push(url.href);
    if (url.pathname.startsWith('/stats/')) requests.push(url.pathname);
    if (url.pathname === '/api/website/settings') settingsReads.push(new URL(page.url()).pathname);
  });
  await page.route('**/stats/pa-e2e.js', (route) =>
    route.fulfill({ status: 200, contentType: 'text/javascript', body: PLAUSIBLE_STAND_IN }),
  );
  await page.route('**/stats/event', (route) => {
    const event = route.request().postDataJSON() as { n: string; u: string };
    events.push({ n: event.n, u: event.u });
    return route.fulfill({ status: 202, contentType: 'text/plain', body: 'ok' });
  });
  const seen = <K extends keyof PlausibleSeen>(key: K) =>
    page.evaluate((name) => (window as unknown as PlausibleSeen)[name], key);
  return { requests, settingsReads, events, seen };
}

test('analytics loads from this origin only when the deployment names its script, and never before the settings', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const analytics = await serveAnalytics(page);
  await mockSignedOut(page, {
    'GET /api/website/settings': (route) => json(route, 200, ANALYTICS_ON),
  });
  await page.goto('/');
  await waitForFonts(page);

  const script = page.locator('script[data-analytics]');
  await expect(script).toHaveCount(1);
  await expect(script).toHaveAttribute('src', '/stats/pa-e2e.js');
  // The script counts nothing on its own; the homepage's one count waited for it in the queue.
  await expect
    .poll(() => analytics.seen('__plausibleSeen'))
    .toEqual({
      endpoint: '/stats/event',
      autoCapturePageviews: false,
      outboundLinks: false,
      fileDownloads: false,
      formSubmissions: false,
      logging: false,
      transformRequest: 'function',
      queued: [['pageview', { url: `${ownOrigin()}/` }]],
    });
  expect(await analytics.seen('__plausibleSent')).toEqual([{ n: 'pageview', u: '/', on: '/' }]);

  // A section link stays on the page: no second count.
  await page.locator('app-home-header nav').getByRole('link', { name: 'The week' }).click();
  await expect(page).toHaveURL(/\/#week$/);
  expect(await analytics.seen('__plausibleSent')).toEqual([{ n: 'pageview', u: '/', on: '/' }]);
  // Everything the page asked for came from its own origin: the proxied script and its one event.
  await expect.poll(() => analytics.requests).toEqual(['/stats/pa-e2e.js', '/stats/event']);
});

test.describe('the visitor count (notes plan N1)', () => {
  const owner = { ...SIGNED_IN_USER, id: OWNER_ID, displayName: 'Karim Haddad' };
  const workspace = {
    id: OWNER_MEMBERSHIP.tenantId,
    name: 'Atlas Performance',
    slug: 'atlas-performance',
    timeZoneId: 'Asia/Beirut',
    defaultCulture: 'en-LB',
    defaultCurrencyCode: 'USD',
    weekStartsOn: 'Monday',
    currentDate: COACH_NOW.slice(0, 10),
    version: 1,
    brandColor: null,
    accentColor: null,
    logoAssetId: null,
  };

  test('a visitor who signs in from the homepage is counted once, on the homepage, and nothing is sent from the app', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const analytics = await serveAnalytics(page);
    let signedIn = false;
    await mockSession(page, {
      memberships: [OWNER_MEMBERSHIP],
      user: owner,
      extra: {
        'GET /api/auth/me': (route: Route) => json(route, 200, signedIn ? owner : null),
        'POST /api/auth/login': (route: Route) => {
          signedIn = true;
          return json(route, 200, owner);
        },
        'GET /api/website/settings': (route: Route) => json(route, 200, ANALYTICS_ON),
        'GET /api/website/contact-form': (route: Route) => json(route, 200, { stamp: 'e2e-stamp' }),
        'GET /api/coach-today': (route: Route) => json(route, 200, emptyCoachTodayView()),
        'GET /api/clients/overview': (route: Route) => json(route, 200, clientListView()),
        'GET /api/clients/former': (route: Route) => json(route, 200, []),
        'GET /api/workspace': (route: Route) => json(route, 200, workspace),
      },
    });
    await page.goto('/');
    await waitForFonts(page);
    await expect
      .poll(() => analytics.seen('__plausibleSent'))
      .toEqual([{ n: 'pageview', u: '/', on: '/' }]);

    await page.locator('app-home-header nav').getByRole('link', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/auth\/sign-in$/);
    // The homepage closed, so its time on page went out with it; then the script was told of a
    // page it must not count, which ends that time.
    const closed = [
      { n: 'pageview', u: '/', on: '/' },
      { n: 'engagement', u: '/', on: '/auth/sign-in' },
    ];
    expect(await analytics.seen('__plausibleSent')).toEqual(closed);

    await page.getByLabel('Email').fill('karim@atlas.example');
    await page.getByLabel('Password', { exact: true }).fill('a-good-password');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(`${ownOrigin()}/`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.getByRole('link', { name: 'Clients', exact: true }).first().click();
    await expect(page).toHaveURL(/\/clients$/);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    // The coach switches to another app: the tab is hidden and loses focus.
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => 'hidden',
      });
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('blur'));
    });

    expect(await analytics.seen('__plausibleSent')).toEqual(closed);
    expect(await analytics.seen('__plausibleCalls')).toEqual([
      ['pageview', { url: `${ownOrigin()}/` }],
      ['pageview', { url: 'about:blank' }],
    ]);
    await expect
      .poll(() => analytics.requests)
      .toEqual(['/stats/pa-e2e.js', '/stats/event', '/stats/event']);
    expect(analytics.settingsReads).toEqual(['/']);
  });

  test('What changed counts a visitor on each opening, the homepage’s time going out as it closes', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const analytics = await serveAnalytics(page);
    await mockSignedOut(page, {
      'GET /api/website/settings': (route) => json(route, 200, ANALYTICS_ON),
    });
    await page.goto('/');
    await waitForFonts(page);
    await expect
      .poll(() => analytics.seen('__plausibleSent'))
      .toEqual([{ n: 'pageview', u: '/', on: '/' }]);

    await page
      .locator('app-home-finale')
      .getByRole('link', { name: /What changed/ })
      .click();
    await expect(page.getByRole('heading', { level: 1, name: 'What changed' })).toBeVisible();
    await expect
      .poll(() => analytics.seen('__plausibleSent'))
      .toEqual([
        { n: 'pageview', u: '/', on: '/' },
        { n: 'engagement', u: '/', on: '/changelog' },
        { n: 'pageview', u: '/changelog', on: '/changelog' },
      ]);
  });

  test('someone signed in who opens What changed reads no settings, loads no script and sends nothing', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const analytics = await serveAnalytics(page);
    await mockSession(page, {
      memberships: [OWNER_MEMBERSHIP],
      user: owner,
      extra: { 'GET /api/website/settings': (route: Route) => json(route, 200, ANALYTICS_ON) },
    });
    await page.goto('/changelog');
    await expect(page.locator('.changelog--embedded')).toBeVisible();
    await expect(page.locator('.release').first()).toBeVisible();
    // The app's shell is drawn once the memberships are in, after which the page has decided.
    await expect(page.getByRole('link', { name: 'Clients', exact: true }).first()).toBeVisible();
    await page.waitForTimeout(500);

    expect(analytics.settingsReads).toEqual([]);
    await expect(page.locator('script[data-analytics]')).toHaveCount(0);
    expect(await page.evaluate(() => typeof (window as { plausible?: unknown }).plausible)).toBe(
      'undefined',
    );
    expect(analytics.requests).toEqual([]);
  });

  // Notes plan N2: the sign-up page counts itself as What changed does, on the owners' word.
  test('the sign-up page counts a visitor once, by its path and campaign tags alone, and the homepage after it once', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const analytics = await serveAnalytics(page);
    const origin = ownOrigin();
    await mockSignedOut(page, {
      'GET /api/website/settings': (route) => json(route, 200, ANALYTICS_ON),
    });
    await page.goto('/auth/register?utm_source=x&email=someone@example.com');
    await expect(page.getByRole('heading', { level: 1, name: /Create your/ })).toBeVisible();

    await expect
      .poll(() => analytics.seen('__plausibleSent'))
      .toEqual([{ n: 'pageview', u: '/auth/register', on: '/auth/register' }]);
    await expect(page.locator('script[data-analytics]')).toHaveAttribute('src', '/stats/pa-e2e.js');
    // The page asked once, with the address it was opened at; what left the browser is its path
    // and the campaign tag, never the rest of the query.
    expect(await analytics.seen('__plausibleCalls')).toEqual([
      ['pageview', { url: `${origin}/auth/register?utm_source=x&email=someone@example.com` }],
    ]);
    const signUp = `${origin}/auth/register?utm_source=x`;
    await expect.poll(() => analytics.events).toEqual([{ n: 'pageview', u: signUp }]);
    expect(analytics.settingsReads).toEqual(['/auth/register']);
    // Staying on the page and typing into it counts nothing more.
    await page.getByLabel('Email', { exact: true }).fill('rami@example.com');
    await page.waitForTimeout(500);
    expect(analytics.events).toHaveLength(1);

    // The wordmark leads to the homepage, a counted page too: the sign-up page's time goes out as
    // it closes, and the homepage is counted once.
    await page.locator('a.auth__brand').click();
    await expect(page).toHaveURL(`${origin}/`);
    await expect(page.getByRole('heading', { level: 1, name: HEADLINE })).toBeVisible();
    await expect
      .poll(() => analytics.seen('__plausibleSent'))
      .toEqual([
        { n: 'pageview', u: '/auth/register', on: '/auth/register' },
        { n: 'engagement', u: '/auth/register', on: '/' },
        { n: 'pageview', u: '/', on: '/' },
      ]);
    await page.waitForTimeout(500);
    expect(analytics.events).toEqual([
      { n: 'pageview', u: signUp },
      { n: 'engagement', u: signUp },
      { n: 'pageview', u: `${origin}/` },
    ]);
    expect(JSON.stringify(analytics.events)).not.toContain('someone');
    expect(analytics.requests).toEqual([
      '/stats/pa-e2e.js',
      '/stats/event',
      '/stats/event',
      '/stats/event',
    ]);
    // The settings were read once, on the page the visit began at.
    expect(analytics.settingsReads).toEqual(['/auth/register']);
  });

  for (const path of ['/auth/sign-in']) {
    test(`a visitor on ${path} loads no script and queues nothing`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      const analytics = await serveAnalytics(page);
      await mockSignedOut(page, {
        'GET /api/website/settings': (route) => json(route, 200, ANALYTICS_ON),
      });
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await page.waitForTimeout(500);

      await expect(page.locator('script[data-analytics]')).toHaveCount(0);
      expect(await page.evaluate(() => typeof (window as { plausible?: unknown }).plausible)).toBe(
        'undefined',
      );
      expect(analytics.settingsReads).toEqual([]);
      expect(analytics.requests).toEqual([]);
    });
  }
});

test.describe('the homepage inside the app, at /about (notes plan N2)', () => {
  const owner = { ...SIGNED_IN_USER, id: OWNER_ID, displayName: 'Karim Haddad' };
  const SIZES = [
    [1440, 900],
    [390, 844],
  ] as const;
  type Size = (typeof SIZES)[number];
  type Analytics = Awaited<ReturnType<typeof serveAnalytics>>;

  /**
   * /about for a visitor, for an owner, or for an account with no coaching space left (a former
   * client). The deployment names its analytics script, so a count would be seen if one were made.
   */
  async function openAbout(
    page: Page,
    who: 'visitor' | 'owner' | 'former client',
    [width, height]: Size,
    motion = false,
  ): Promise<Analytics> {
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ reducedMotion: motion ? 'no-preference' : 'reduce' });
    const analytics = await serveAnalytics(page);
    const website = {
      'GET /api/website/settings': (route: Route) => json(route, 200, ANALYTICS_ON),
      'GET /api/website/contact-form': (route: Route) => json(route, 200, { stamp: 'e2e-stamp' }),
    };
    if (who === 'visitor') {
      await mockSignedOut(page, website);
    } else {
      await mockSession(page, {
        memberships: who === 'owner' ? [OWNER_MEMBERSHIP] : [],
        user: owner,
        extra: {
          ...website,
          'GET /api/coach-today': (route: Route) => json(route, 200, emptyCoachTodayView()),
        },
      });
    }
    await page.goto('/about');
    await waitForFonts(page);
    await expect(page.getByRole('heading', { level: 1, name: HEADLINE })).toBeVisible();
    await expect(page.locator('#week')).toHaveAttribute('data-motion', /running|off/);
    return analytics;
  }

  /** Every link within the page leads to the page's own address, so none leaves it for `/`. */
  async function expectLinksStayOnAbout(page: Page): Promise<void> {
    await expect(page.locator('a[href^="/#"]')).toHaveCount(0);
    await expect(page.locator('a.brand')).toHaveAttribute('href', '/about');
    await expect(page.locator('.skip-link')).toHaveAttribute('href', '/about#home-content');
    for (const section of ['week', 'inside', 'for-gyms']) {
      // The wide header's link and the phone menu's.
      await expect(page.locator(`a[href="/about#${section}"]`)).toHaveCount(2);
    }
    // The hero's, the gym half's and the finale's Talk to us.
    await expect(page.locator('a[href="/about#talk"]')).toHaveText([
      /Talk to us about your gym/,
      /Talk to us about your gym/,
      /Talk to us about your gym/,
    ]);
  }

  async function expectNoIndex(page: Page): Promise<void> {
    const robots = page.locator('head meta[name="robots"]');
    await expect(robots).toHaveCount(1);
    await expect(robots).toHaveAttribute('content', 'noindex');
  }

  /**
   * Nothing was counted: once the settings are read, no page view waits in the queue, the script was
   * told of none and sent no event. The script is a visitor's alone: for a visitor it may load and
   * nothing else is asked of /stats/; for someone signed in nothing at all is asked of /stats/, so
   * no request there carries their session, and no script tag is added.
   */
  async function expectNothingCounted(
    page: Page,
    analytics: Analytics,
    who: 'visitor' | 'signed in',
  ): Promise<void> {
    await expect.poll(() => analytics.settingsReads).toEqual(['/about']);
    await page.waitForTimeout(500);
    const left = await page.evaluate(() => {
      const seen = window as unknown as PlausibleSeen & { plausible?: { q?: unknown[] } };
      return {
        waiting: (seen.plausible?.q ?? []).length,
        queued: seen.__plausibleSeen?.['queued'] ?? [],
        calls: seen.__plausibleCalls ?? [],
        sent: seen.__plausibleSent ?? [],
      };
    });
    expect(left).toEqual({ waiting: 0, queued: [], calls: [], sent: [] });
    expect(analytics.events).toEqual([]);
    if (who === 'visitor') {
      await expect(page.locator('script[data-analytics]')).toHaveAttribute(
        'src',
        '/stats/pa-e2e.js',
      );
      expect(analytics.requests).toEqual(['/stats/pa-e2e.js']);
    } else {
      await expect(page.locator('script[data-analytics]')).toHaveCount(0);
      expect(analytics.requests).toEqual([]);
    }
  }

  /** Back to Today where it can be pressed: in the header, or on a phone in the header's menu. */
  async function backToToday(page: Page, width: number) {
    const header = page.locator('app-home-header');
    if (width >= 1100) return header.locator('.links .links__sign');
    await expect(header.locator('.links')).toBeHidden();
    await header.getByRole('button', { name: 'Menu' }).click();
    await expect(page.locator('#home-menu')).toBeVisible();
    return page.locator('#home-menu').getByRole('link', { name: 'Back to Today' });
  }

  for (const size of SIZES) {
    const [width] = size;

    test(`an owner on /about at ${width}px gets Back to Today where Sign in stood, no sign-up, links that stay on the page, noindex and no count`, async ({
      page,
    }, testInfo) => {
      const analytics = await openAbout(page, 'owner', size);

      // The page fills the window as a visitor sees it, with no shell around it.
      await expect(page.locator('app-coach-shell')).toHaveCount(0);
      await expect(page.locator('.topbar')).toHaveCount(0);
      await expect(page).toHaveTitle('TB Gym: coach both sides of the week');
      // No sign-up and no sign-in anywhere on it: not in the header's menu, the hero, the six rows,
      // who it's for, the clients' strip or the finale.
      await expect(page.getByText('Start your coaching space')).toHaveCount(0);
      await expect(page.locator('a[href="/auth/register"]')).toHaveCount(0);
      await expect(page.locator('a[href="/auth/sign-in"]')).toHaveCount(0);
      await expect(page.locator('.row')).toHaveCount(6);
      await expect(page.locator('.row__link')).toHaveCount(0);
      await expect(page.locator('.clients p')).toHaveText(
        'Here as a client? Your coach sends the invitation.',
      );
      await expect(page.locator('.clients a')).toHaveCount(0);
      // What stays: Talk to us with its form, and What changed.
      await expect(page.locator('#talk form')).toBeAttached();
      await expect(page.locator('.foot__links a[href="/changelog"]')).toHaveText(/What changed/);

      // Back to Today stands in the header, in the phone menu and in the foot, and leads to `/`.
      const header = page.locator('app-home-header');
      await expect(header.locator('.links .links__sign')).toHaveText('Back to Today');
      await expect(page.locator('#home-menu a')).toHaveText([
        'The week',
        "What's inside",
        'For gyms',
        'Back to Today',
      ]);
      await expect(page.locator('.foot__links a')).toHaveText([/What changed/, 'Back to Today']);
      const ways = page.locator('a[href="/"]');
      await expect(ways).toHaveText(['Back to Today', 'Back to Today', 'Back to Today']);
      await expectLinksStayOnAbout(page);
      await expectNoIndex(page);

      // Who it's for without the coach's button: side by side, the two screens still start on one line.
      if (width >= 1100) {
        const top = async (half: 'coach' | 'gym') =>
          (await page.locator(`.half--${half} .half__shot`).boundingBox())!.y;
        expect(Math.abs((await top('coach')) - (await top('gym')))).toBeLessThan(1);
      }
      // The pill's empty holder takes no room before Talk to us. Its display is read, since an empty
      // holder has no height either way.
      await expect(page.locator('.finale__magnet')).toHaveCSS('display', 'none');
      await expect(page.locator('.finale__magnet a')).toHaveCount(0);

      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: testInfo.outputPath('about-owner-full.png'), fullPage: true });
      const accessibility = await new AxeBuilder({ page }).analyze();
      expect(accessibility.violations).toEqual([]);

      // A section link and Talk to us stay on the page; signed in they would otherwise open Today.
      if (width >= 1100) {
        await header.locator('.links').getByRole('link', { name: 'The week' }).click();
        await expect(page).toHaveURL('/about#week');
        await expect(page.locator('#week')).toBeInViewport();
      } else {
        await header.getByRole('button', { name: 'Menu' }).click();
        await page.locator('#home-menu').getByRole('link', { name: 'For gyms' }).click();
        await expect(page).toHaveURL('/about#for-gyms');
        await expect(page.locator('#home-menu')).toBeHidden();
        await expect(page.locator('#for-gyms')).toBeInViewport();
      }
      await page.locator('.finale__talk').click();
      await expect(page).toHaveURL('/about#talk');
      await expect(page.locator('#talk')).toBeInViewport();
      await expect(page.getByRole('heading', { level: 1, name: HEADLINE })).toBeAttached();
      await expect(page.locator('app-coach-shell')).toHaveCount(0);
      await expectNoIndex(page);
      await expectNothingCounted(page, analytics, 'signed in');

      const back = await backToToday(page, width);
      await expect(back).toBeVisible();
      await expect(back).toBeInViewport({ ratio: 1 });
      if (width < 1100) {
        await page.screenshot({ path: testInfo.outputPath('about-owner-menu.png') });
      }
      await back.click();
      await expect(page).toHaveURL('/');
      await expect(page.locator('app-coach-shell')).toBeVisible();
      await expect(page.locator('app-home-header')).toHaveCount(0);
      await expect(page).toHaveTitle('Today | TB Gym');
      // Leaving takes the tag with it: Today asks nothing of search engines.
      await expect(page.locator('meta[name="robots"]')).toHaveCount(0);
      // And closing the page sent nothing either: no script ever landed for someone signed in, so
      // none was told of anything, and nothing was asked of /stats/ at all.
      await page.waitForTimeout(300);
      expect(await analytics.seen('__plausibleCalls')).toBeUndefined();
      await expect(page.locator('script[data-analytics]')).toHaveCount(0);
      expect(analytics.events).toEqual([]);
      expect(analytics.requests).toEqual([]);
    });

    test(`the foot’s Back to Today leads an owner from /about to Today at ${width}px`, async ({
      page,
    }) => {
      await openAbout(page, 'owner', size);
      const foot = page.locator('.foot__links').getByRole('link', { name: 'Back to Today' });
      await foot.scrollIntoViewIfNeeded();
      await expect(foot).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await foot.click();
      await expect(page).toHaveURL('/');
      await expect(page.locator('app-coach-shell')).toBeVisible();
      await expect(page.locator('app-home-header')).toHaveCount(0);
    });

    test(`/about keeps Back to Today in reach for an owner at ${width}px with 200% text`, async ({
      page,
    }, testInfo) => {
      await openAbout(page, 'owner', size);
      await page.evaluate(() => (document.documentElement.style.fontSize = '32px'));
      await expectNoHorizontalOverflow(page);

      const back = await backToToday(page, width);
      await expect(back).toBeVisible();
      await expect(back).toBeInViewport({ ratio: 1 });
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: testInfo.outputPath('about-owner-200.png') });
      await back.click();
      await expect(page).toHaveURL('/');
      await expect(page.locator('app-coach-shell')).toBeVisible();
    });

    test(`/about mirrors cleanly right-to-left and keeps Back to Today in reach for an owner at ${width}px`, async ({
      page,
    }, testInfo) => {
      await openAbout(page, 'owner', size);
      await page.evaluate(() => (document.documentElement.dir = 'rtl'));
      await expectNoHorizontalOverflow(page);
      await expect(page.getByRole('heading', { level: 1, name: HEADLINE })).toBeVisible();

      const back = await backToToday(page, width);
      await expect(back).toBeVisible();
      await expect(back).toBeInViewport({ ratio: 1 });
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: testInfo.outputPath('about-owner-rtl.png') });
      await back.click();
      await expect(page).toHaveURL('/');
      await expect(page.locator('app-coach-shell')).toBeVisible();
    });

    test(`a visitor on /about at ${width}px gets Sign in and Start as on the homepage, links that stay on the page, noindex and no count`, async ({
      page,
    }, testInfo) => {
      const analytics = await openAbout(page, 'visitor', size);

      const header = page.locator('app-home-header');
      await expect(header.locator('.links .links__sign')).toHaveText('Sign in');
      await expect(header.locator('.links .links__sign')).toHaveAttribute('href', '/auth/sign-in');
      await expect(page.locator('#home-menu a')).toHaveText([
        'The week',
        "What's inside",
        'For gyms',
        'Sign in',
        'Start your coaching space',
      ]);
      // As at the homepage's own address: the header's and its menu's, the clients' strip's and
      // the foot's Sign in; four Start buttons and the six rows' links to sign-up.
      await expect(page.locator('a[href="/auth/sign-in"]')).toHaveCount(4);
      await expect(page.locator('a[href="/auth/register"]')).toHaveCount(10);
      await expect(
        page.locator('a[href="/auth/register"]', { hasText: 'Start your coaching space' }),
      ).toHaveCount(4);
      await expect(page.locator('.row__link')).toHaveCount(6);
      await expect(page.locator('.clients a')).toHaveAttribute('href', '/auth/sign-in');
      await expect(page.locator('.foot__links a')).toHaveText([/What changed/, 'Sign in']);
      await expect(page.getByText('Back to Today')).toHaveCount(0);
      await expect(page.locator('a[href="/"]')).toHaveCount(0);
      await expectLinksStayOnAbout(page);
      await expectNoIndex(page);
      await expectNoHorizontalOverflow(page);
      await page.screenshot({
        path: testInfo.outputPath('about-visitor-full.png'),
        fullPage: true,
      });
      const accessibility = await new AxeBuilder({ page }).analyze();
      expect(accessibility.violations).toEqual([]);

      await page.locator('.hero__talk').click();
      await expect(page).toHaveURL('/about#talk');
      await expect(page.locator('#talk')).toBeInViewport();
      await expectNothingCounted(page, analytics, 'visitor');

      // The wordmark stays on the page too; Sign in leaves it, and the tag goes with it.
      await header.locator('a.brand').click();
      await expect(page).toHaveURL('/about');
      await expect(page.getByRole('heading', { level: 1, name: HEADLINE })).toBeVisible();
      await expectNoIndex(page);
      await page.locator('.foot__links').getByRole('link', { name: 'Sign in' }).click();
      await expect(page).toHaveURL('/auth/sign-in');
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expect(page.locator('meta[name="robots"]')).toHaveCount(0);
      expect(analytics.events).toEqual([]);
    });

    test(`a visitor on /about at ${width}px still has the pill in its holder, and both halves’ buttons`, async ({
      page,
    }) => {
      await openAbout(page, 'visitor', size);

      await expect(page.locator('.finale__magnet')).not.toHaveCSS('display', 'none');
      await expect(page.locator('.finale__magnet .finale__start')).toHaveAttribute(
        'href',
        '/auth/register',
      );
      await expect(page.locator('.half--plain')).toHaveCount(0);
      await expect(page.locator('.half .half__button')).toHaveCount(2);
    });

    test(`a former client who types /about at ${width}px sees the page without the account bar and gets Back to Today`, async ({
      page,
    }) => {
      const analytics = await openAbout(page, 'former client', size);

      await expect(page.locator('header.topbar')).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Sign out' })).toHaveCount(0);
      await expect(page.locator('a[href="/auth/register"]')).toHaveCount(0);
      await expect(page.locator('a[href="/auth/sign-in"]')).toHaveCount(0);
      await expectLinksStayOnAbout(page);
      await expectNoIndex(page);
      await expectNoHorizontalOverflow(page);
      await expectNothingCounted(page, analytics, 'signed in');

      const back = await backToToday(page, width);
      await expect(back).toBeVisible();
      await expect(back).toHaveAttribute('href', '/');
      await back.click();
      await expect(page).toHaveURL('/');
      // `/` for an account with no coaching space: the plain bar is back around its page.
      await expect(page.locator('header.topbar')).toBeVisible();
      await expect(page.locator('app-empty-state')).toContainText(
        'ask your coach to send you a new invitation',
      );
      await expect(page.locator('app-home-header')).toHaveCount(0);
      await expect(page.locator('meta[name="robots"]')).toHaveCount(0);
      expect(analytics.events).toEqual([]);
    });
  }

  /**
   * The page moves on a wide screen (R6.2k). Signed in, the rows have no link and the finale no pill,
   * which the motion is set up around: what is left still arrives, the closing line still rises, and
   * the light still follows a mouse, with the pill's holder out of the way.
   */
  test('an owner on /about at 1440px with motion on sees the rows arrive and the closing line rise, without the pill', async ({
    page,
  }) => {
    await openAbout(page, 'owner', [1440, 900], true);
    await expect(page.locator('#week')).toHaveAttribute('data-motion', 'running');
    await expect(page.locator('.row__link')).toHaveCount(0);

    // A row still below the screen holds its words and screens aside; scrolled to, they arrive.
    const row = page.locator('[data-row="messages"]');
    await expect(row.locator('.row__body')).toHaveCSS('opacity', '0');
    await row.evaluate((element) => element.scrollIntoView({ block: 'center' }));
    await expect(row.locator('.pair__window')).toHaveCSS('opacity', '1');
    await expect(row.locator('.pair__window')).toHaveCSS('transform', 'none');
    await expect(row.locator('.row__body')).toHaveCSS('opacity', '1');

    // Who it's for: both screens arrive, the coach's without a button above it.
    await page.evaluate(() => document.getElementById('for-gyms')?.scrollIntoView());
    await expect(page.locator('.half__shot').first()).toHaveCSS('opacity', '1');
    await expect(page.locator('.half__shot').last()).toHaveCSS('opacity', '1');

    // The closing line is split into words and read whole; Talk to us follows it in.
    const title = page.locator('.finale__title');
    await title.evaluate((element) => element.scrollIntoView({ block: 'center' }));
    await expect(title).toHaveAttribute(
      'aria-label',
      /^\s*Your next client's week starts here\.\s*$/,
    );
    const talk = page.locator('.finale__talk');
    await expect(talk).toHaveCSS('opacity', '1');
    const box = (await talk.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 30, { steps: 6 });
    await expect(page.locator('.finale__glow')).not.toHaveCSS('transform', 'none');
    await expect(page.locator('.finale__magnet')).toHaveCSS('display', 'none');
    await expect(page.locator('.finale__start')).toHaveCount(0);
  });
});
