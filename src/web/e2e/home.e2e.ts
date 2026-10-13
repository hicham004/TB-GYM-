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
  // and Sunday's maxes run down to its foot.
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
