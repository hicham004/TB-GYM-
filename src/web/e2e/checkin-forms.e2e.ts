import AxeBuilder from '@axe-core/playwright';
import {
  expect,
  expectNoHorizontalOverflow,
  json,
  mockSession,
  test,
  useRtl,
  waitForFonts,
} from './support';

test('forced colours hand the form’s question kind, a native select until A14b, to the platform', async ({
  page,
}) => {
  // The kit select draws its own chevron in the text colour; the one native select left must show
  // the platform's arrow rather than the fixed-colour image `.tb-select` paints (styles/_ui.scss).
  await page.emulateMedia({ forcedColors: 'active' });
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockSession(page, {
    extra: {
      'GET /api/checkins/forms': (route) => json(route, 200, { total: 0, items: [] }),
      'GET /api/clients': (route) => json(route, 200, []),
      'GET /api/workspace': (route) =>
        json(route, 200, { timeZoneId: 'Asia/Beirut', weekStartsOn: 'Monday' }),
    },
  });
  await page.goto('/checkins/forms');
  await page.getByRole('button', { name: 'New form', exact: true }).click();
  const kind = page.locator('select.tb-select').first();
  await expect(kind).toBeVisible();
  expect(
    await kind.evaluate((element) => {
      const style = getComputedStyle(element);
      return { appearance: style.appearance, image: style.backgroundImage };
    }),
  ).toEqual({ appearance: 'auto', image: 'none' });
});

for (const width of [390, 1440]) {
  test(`check-in forms protect edits and reflow on the kit at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await mockSession(page, {
      extra: {
        'GET /api/checkins/forms': (route) => json(route, 200, { total: 0, items: [] }),
        'GET /api/clients': (route) => json(route, 200, []),
        'GET /api/workspace': (route) =>
          json(route, 200, { timeZoneId: 'Asia/Beirut', weekStartsOn: 'Monday' }),
      },
    });
    await page.goto('/checkins/forms');
    await expect(page).toHaveTitle('Check-in forms | TB Gym');
    await expect(page.getByRole('heading', { name: 'Check-in forms', exact: true })).toBeFocused();
    await page.getByRole('button', { name: 'New form', exact: true }).click();
    await page.getByLabel('Title', { exact: true }).fill('Weekly recovery');
    await page.getByRole('link', { name: 'Client check-ins', exact: true }).click();
    const warning = page.getByRole('dialog', { name: 'Leave without saving?' });
    await expect(warning).toBeVisible();
    await warning.getByRole('button', { name: 'Stay', exact: true }).click();
    await expect(page).toHaveURL('/checkins/forms');
    await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Weekly recovery');
    await page.getByRole('button', { name: 'Save draft', exact: true }).click();
    await expect(page.locator('#builder-summary')).toBeFocused();
    await expect(page.locator('#builder-summary')).toContainText('A question needs a prompt.');
    await waitForFonts(page);
    await expectNoHorizontalOverflow(page);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({
      path: `test-results/r53f-checkin-refused-${width}.png`,
      fullPage: true,
    });
    await page.emulateMedia({ colorScheme: 'dark' });
    const background = () =>
      page
        .locator('main')
        .evaluate((main) => getComputedStyle(main).getPropertyValue('--tb-bg').trim());
    await expect.poll(background).toBe('#0f1513');
    await useRtl(page);
    await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
    await expectNoHorizontalOverflow(page);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.getByRole('link', { name: 'Client check-ins', exact: true }).click();
    await warning.getByRole('button', { name: 'Leave without saving', exact: true }).click();
    await expect(page).toHaveURL('/checkins/clients');
    await expect.poll(background).toBe('#0f1513');
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await expect(
      page.getByRole('heading', { name: 'Client check-ins', exact: true }),
    ).toBeFocused();
  });
}
