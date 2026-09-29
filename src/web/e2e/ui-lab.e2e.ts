import AxeBuilder from '@axe-core/playwright';
import type { Locator, Page } from '@playwright/test';
import os from 'node:os';
import { expect, expectNoHorizontalOverflow, mockSignedOut, test, waitForFonts } from './support';

/**
 * Browser checks for the development-only UI lab: layout at phone, tablet and desktop widths in
 * both directions, keyboard focus, activation of disabled and loading controls, wrapping, text
 * enlargement and the automated accessibility scan. Screenshots use fixed fixtures and the bundled
 * fonts; the environment is recorded because baselines are only comparable on the same one.
 */
const ACCENT = 'rgb(15, 118, 110)';
const WIDTHS = [390, 1024, 1440] as const;
const DIRECTIONS = ['ltr', 'rtl'] as const;
const PRIMITIVES = '.tb-button, .tb-icon-button, .tb-control, .tb-checkbox-input';

async function openLab(page: Page, options: { width?: number; dir?: 'ltr' | 'rtl' } = {}) {
  await page.setViewportSize({ width: options.width ?? 1440, height: 900 });
  await mockSignedOut(page);
  await page.goto(`/dev/ui-lab${options.dir === 'rtl' ? '?dir=rtl' : ''}`);
  await expect(page.getByRole('heading', { level: 1, name: 'UI lab' })).toBeVisible();
  await waitForFonts(page);
}

/** What the focused element looks like, for asserting a visible 3px accent ring at 2px. */
function focusedRing(page: Page) {
  return page.evaluate(() => {
    const element = document.activeElement as HTMLElement;
    const style = getComputedStyle(element);
    return {
      name: element.getAttribute('aria-label') || element.id || element.textContent?.trim() || '',
      primitive: element.matches('.tb-button, .tb-icon-button, .tb-control, .tb-checkbox-input'),
      disabled: (element as HTMLButtonElement).disabled === true,
      insideLab: element.closest('app-ui-lab') !== null,
      outline: `${style.outlineStyle} ${style.outlineWidth} ${style.outlineColor}`,
      offset: style.outlineOffset,
    };
  });
}

/** The element's box grown by the 5px focus reach (2px gap + 3px ring). */
async function ringBox(locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error('No box for the focused element.');
  return {
    top: box.y - 5,
    bottom: box.y + box.height + 5,
    left: box.x - 5,
    right: box.x + box.width + 5,
  };
}

/** The visible clip rectangle of a scroll container: its padding box. */
function clipBox(locator: Locator) {
  return locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    const top = rect.top + parseFloat(style.borderTopWidth);
    const left = rect.left + parseFloat(style.borderLeftWidth);
    return { top, left, bottom: top + element.clientHeight, right: left + element.clientWidth };
  });
}

test('records the screenshot environment', async ({ browser }) => {
  const environment = `${browser.browserType().name()} ${browser.version()} · ${os.type()} ${os.release()} (${os.platform()} ${os.arch()})`;
  test.info().annotations.push({ type: 'environment', description: environment });
  console.log(`Screenshot environment: ${environment}`);
});

for (const width of WIDTHS) {
  for (const dir of DIRECTIONS) {
    test(`at ${width}px ${dir}: no sideways scroll, no axe violations, stable rendering`, async ({
      page,
    }) => {
      await openLab(page, { width, dir });

      await expectNoHorizontalOverflow(page);
      const scan = await new AxeBuilder({ page })
        .include('app-ui-lab')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
        .analyze();
      expect(
        scan.violations.map((violation) => `${violation.id}: ${violation.nodes.length}`),
      ).toEqual([]);
      await expect(page).toHaveScreenshot(`lab-${width}-${dir}.png`, { fullPage: true });
    });
  }
}

test('every tab stop in the lab shows the 3px accent ring and skips disabled controls', async ({
  page,
}) => {
  await openLab(page);
  await page.getByRole('heading', { level: 1, name: 'UI lab' }).click();

  const stops: Awaited<ReturnType<typeof focusedRing>>[] = [];
  for (let step = 0; step < 120; step++) {
    await page.keyboard.press('Tab');
    const ring = await focusedRing(page);
    if (!ring.insideLab) break;
    stops.push(ring);
  }

  expect(stops.length).toBeGreaterThan(30);
  expect(stops.filter((stop) => stop.disabled)).toEqual([]);
  expect(stops.map((stop) => stop.name)).not.toContain('lab-summary');
  for (const stop of stops.filter((candidate) => candidate.primitive)) {
    expect(stop.outline, stop.name).toBe(`solid 3px ${ACCENT}`);
    expect(stop.offset, stop.name).toBe('2px');
  }
});

for (const dir of DIRECTIONS) {
  test(`${dir}: focus rings at the first and last rows of a scroll region are not clipped`, async ({
    page,
  }) => {
    await openLab(page, { width: 390, dir });
    const region = page.getByRole('group', { name: 'Scrolling options' });
    const boxes = region.locator('input[type="checkbox"]');

    await page.getByRole('button', { name: 'End edge' }).focus();
    await page.keyboard.press('Tab');
    await expect(boxes.first()).toBeFocused();
    let clip = await clipBox(region);
    let ring = await ringBox(boxes.first());
    expect(ring.top).toBeGreaterThanOrEqual(clip.top);
    expect(ring.left).toBeGreaterThanOrEqual(clip.left);
    expect(ring.right).toBeLessThanOrEqual(clip.right);

    const count = await boxes.count();
    for (let index = 1; index < count; index++) await page.keyboard.press('Tab');
    await expect(boxes.last()).toBeFocused();
    clip = await clipBox(region);
    ring = await ringBox(boxes.last());
    expect(ring.bottom).toBeLessThanOrEqual(clip.bottom);
    expect(ring.left).toBeGreaterThanOrEqual(clip.left);
    expect(ring.right).toBeLessThanOrEqual(clip.right);
    // Centre the region so the shell's sticky top bar cannot overlap the capture.
    await region.evaluate((element) => element.scrollIntoView({ block: 'center' }));
    await expect(region).toHaveScreenshot(`edge-focus-last-${dir}.png`);
  });
}

test('a loading button ignores clicks, Enter and Space; a disabled one ignores clicks', async ({
  page,
}) => {
  await openLab(page);
  const demo = page.getByRole('button', { name: 'Save changes (loading demo)' });
  const log = page.locator('.lab-log');

  await demo.click();
  const saving = page.getByRole('button', { name: 'Saving…' });
  await expect(saving).toHaveAttribute('aria-disabled', 'true');
  await expect(saving).toBeFocused();
  const box = await saving.boundingBox();
  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.keyboard.press('Enter');
  await page.keyboard.press('Space');
  await expect(log).toContainText('Save changes (loading demo): 1');

  await expect(page.getByRole('button', { name: 'Save changes (loading demo)' })).toBeEnabled();
  await expect(demo).not.toHaveAttribute('aria-disabled', 'true');

  const publish = page.getByRole('button', { name: 'Publish', exact: true });
  const publishBox = await publish.boundingBox();
  await page.mouse.click(
    publishBox!.x + publishBox!.width / 2,
    publishBox!.y + publishBox!.height / 2,
  );
  await expect(log).not.toContainText('Publish');
});

test('Enter in a field cannot submit the form again while it is saving', async ({ page }) => {
  await openLab(page);
  const name = page.getByLabel('Exercise name');

  await name.fill('Barbell back squat');
  await page.getByLabel('Equipment', { exact: true }).selectOption('Barbell');
  await name.press('Enter');
  await expect(page.getByRole('button', { name: 'Saving…' })).toHaveAttribute(
    'aria-disabled',
    'true',
  );
  await name.press('Enter');
  await name.press('Enter');

  await expect(
    page.getByRole('status').filter({ hasText: 'Saved in this lab only' }),
  ).toBeVisible();
  await expect(page.locator('dt', { hasText: 'Saves started' }).locator('+ dd')).toHaveText('1');
});

test('reasons appear on leaving a field, and a refused submit focuses the summary', async ({
  page,
}) => {
  await openLab(page);
  const name = page.getByLabel('Exercise name');
  await expect(name).not.toHaveAttribute('aria-invalid', 'true');

  await name.focus();
  await page.keyboard.press('Tab');
  await expect(name).toHaveAttribute('aria-invalid', 'true');
  const describedBy = await name.getAttribute('aria-describedby');
  await expect(page.locator(`#${describedBy}`)).toHaveText('Enter a name for this exercise.');

  await page.getByRole('button', { name: 'Save exercise' }).click();
  const summary = page.locator('#lab-summary');
  await expect(summary).toBeFocused();
  await expect(summary).toContainText('Choose the equipment this exercise uses.');
});

test('wrapped checkbox labels keep the box on the first line; one-line rows stay centred', async ({
  page,
}) => {
  await openLab(page, { width: 390 });
  const measure = (label: string) =>
    page.locator('app-checkbox', { hasText: label }).evaluate((row) => {
      const box = row.querySelector('input')!.getBoundingClientRect();
      const text = row.querySelector('label')!.getBoundingClientRect();
      return { boxCentre: box.top + box.height / 2, rowTop: text.top, rowHeight: text.height };
    });

  const wrapped = await measure('Main lift: coaches may swap it');
  expect(wrapped.rowHeight).toBeGreaterThan(40);
  expect(Math.abs(wrapped.boxCentre - (wrapped.rowTop + 16))).toBeLessThanOrEqual(1);

  const single = await measure('Include in new programs');
  expect(single.rowHeight).toBe(32);
  expect(Math.abs(single.boxCentre - (single.rowTop + single.rowHeight / 2))).toBeLessThanOrEqual(
    1,
  );
});

test('long labels, help and multi-line errors wrap inside the field width', async ({ page }) => {
  await openLab(page, { width: 390 });
  const narrow = page.locator('app-field', { hasText: 'Minimum repetitions' });

  const layout = await narrow.evaluate((field) => {
    const label = field.querySelector('label')!;
    const error = field.querySelector('.tb-field__support--error')!;
    return {
      fieldWidth: field.getBoundingClientRect().width,
      errorWidth: error.getBoundingClientRect().width,
      labelLines: Math.round(label.getBoundingClientRect().height / 20),
      errorHeight: error.getBoundingClientRect().height,
      overflows: field.scrollWidth > field.clientWidth,
    };
  });

  expect(layout.labelLines).toBeGreaterThan(1);
  expect(layout.errorHeight).toBeGreaterThanOrEqual(32);
  expect(Math.abs(layout.errorWidth - layout.fieldWidth)).toBeLessThanOrEqual(1);
  expect(layout.overflows).toBe(false);
});

test('200% text reflows the lab at 390px without clipping any control', async ({ page }) => {
  await openLab(page, { width: 390 });
  await page.evaluate(() => (document.documentElement.style.fontSize = '32px'));

  // Scoped to the lab: the legacy shell's public navigation (unchanged code, `.primary-button` is
  // nowrap) already overflows at 200% text on every route, /auth/sign-in included. That is
  // recorded as pre-existing shell work in docs/FRONTEND-DESIGN-SYSTEM.md, not hidden here.
  const outside = await page.locator('app-ui-lab').evaluate((lab) => {
    const viewport = document.documentElement.clientWidth;
    return Array.from(lab.querySelectorAll('*'))
      .filter((element) => {
        const box = element.getBoundingClientRect();
        return box.width > 0 && (box.right > viewport + 0.5 || box.left < -0.5);
      })
      .map((element) => element.outerHTML.slice(0, 80));
  });
  expect(outside).toEqual([]);
  const clipped = await page.locator(PRIMITIVES).evaluateAll((elements) =>
    elements
      .filter((element) => {
        const style = getComputedStyle(element);
        const lineHeight = parseFloat(style.lineHeight);
        const box = element.getBoundingClientRect();
        const cropped =
          element.scrollHeight > element.clientHeight + 1 && !element.matches('textarea');
        const tooShort =
          element.matches('input:not([type="checkbox"]), select') && box.height < lineHeight;
        return cropped || tooShort;
      })
      .map((element) => element.outerHTML.slice(0, 80)),
  );
  expect(clipped).toEqual([]);
  expect(
    await page
      .getByLabel('Exercise name')
      .evaluate((input) => input.getBoundingClientRect().height),
  ).toBeGreaterThan(40);
});

test('the page reflows at 320px without sideways scrolling', async ({ page }) => {
  await openLab(page, { width: 320 });

  await expectNoHorizontalOverflow(page);
});

test('reduced motion stops the loading spinner', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openLab(page);
  await page.getByLabel('Hold the loading state').check();

  const animation = await page
    .locator('.tb-button--loading')
    .first()
    .evaluate((button) => getComputedStyle(button, '::before').animationName);
  expect(animation).toBe('none');
});

test('forced colours hand the select chevron and checkbox back to the platform', async ({
  page,
}) => {
  await page.emulateMedia({ forcedColors: 'active' });
  await openLab(page);

  const appearance = await page.evaluate(() => ({
    select: getComputedStyle(document.querySelector('.tb-select')!).appearance,
    checkbox: getComputedStyle(document.querySelector('.tb-checkbox-input')!).appearance,
  }));
  expect(appearance).toEqual({ select: 'auto', checkbox: 'auto' });
});
