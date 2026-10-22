import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { chooseOption, kitSelect } from './kit-controls';
import {
  expect,
  expectNoHorizontalOverflow,
  json,
  mockSession,
  test,
  useRtl,
  waitForFonts,
} from './support';

/**
 * Check-in forms in a real browser (audit A14b, AUTH-8): the library as cards, a form on its own page,
 * and a new form started from a weekly check-in. Every read the pages make is answered.
 */
const WORKSPACE = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Atlas Performance',
  slug: 'atlas-performance',
  timeZoneId: 'Asia/Beirut',
  defaultCulture: 'en-LB',
  defaultCurrencyCode: 'USD',
  weekStartsOn: 'Monday',
  currentDate: '2026-10-22',
  version: 1,
};

const WEEKLY = {
  id: 'form-1',
  title: 'Weekly check-in',
  description: 'Takes two minutes. Be honest: it is how I adjust your plan.',
  status: 'Published',
  isArchived: false,
  currentVersionNumber: 1,
  draftVersionId: null,
  latestPublishedVersionId: 'version-1',
  latestPublishedVersionNumber: 1,
  questionCount: 2,
  latestPublishedAtUtc: '2026-10-05T09:00:00Z',
  version: 2,
};

const LIBRARY = [
  WEEKLY,
  {
    ...WEEKLY,
    id: 'form-2',
    title: 'Monthly review',
    description: null,
    status: 'Draft',
    latestPublishedVersionId: null,
    latestPublishedVersionNumber: null,
    latestPublishedAtUtc: null,
    draftVersionId: 'version-7',
    questionCount: 3,
  },
  { ...WEEKLY, id: 'form-3', title: 'Recovery', draftVersionId: 'version-9', questionCount: 4 },
  { ...WEEKLY, id: 'form-4', title: 'Old intake', isArchived: true, questionCount: 5 },
];

const VERSION = {
  id: 'version-1',
  formId: 'form-1',
  formTitle: WEEKLY.title,
  formDescription: WEEKLY.description,
  versionNumber: 1,
  status: 'Published',
  derivedFromVersionId: null,
  publishedAtUtc: WEEKLY.latestPublishedAtUtc,
  publishedByUserId: 'coach-1',
  version: 1,
  questions: [
    {
      id: 'question-1',
      questionKey: 'e'.repeat(32),
      order: 1,
      questionType: 'NumericScale',
      prompt: 'How was your energy this week?',
      helpText: '1 is exhausted, 10 is unstoppable.',
      isRequired: true,
      scaleMinimum: 1,
      scaleMaximum: 10,
      scaleStep: 1,
      options: [],
    },
    {
      id: 'question-2',
      questionKey: 'p'.repeat(32),
      order: 2,
      questionType: 'SingleChoice',
      prompt: 'How closely did you follow your plan?',
      helpText: null,
      isRequired: true,
      scaleMinimum: null,
      scaleMaximum: null,
      scaleStep: null,
      options: [
        { id: 'option-1', order: 1, label: 'All of it' },
        { id: 'option-2', order: 2, label: 'Most of it' },
      ],
    },
  ],
};

async function open(page: Page, width: number, library: unknown[]) {
  await page.setViewportSize({ width, height: 900 });
  await mockSession(page, {
    extra: {
      'GET /api/workspace': (route) => json(route, 200, WORKSPACE),
      'GET /api/checkins/forms': (route) =>
        json(route, 200, { total: library.length, items: library }),
      'GET /api/checkins/forms/form-1': (route) =>
        json(route, 200, {
          form: WEEKLY,
          versions: [
            {
              id: 'version-1',
              versionNumber: 1,
              status: 'Published',
              derivedFromVersionId: null,
              publishedAtUtc: WEEKLY.latestPublishedAtUtc,
              publishedByUserId: 'coach-1',
              questionCount: 2,
              version: 1,
            },
          ],
        }),
      'GET /api/checkins/forms/form-1/versions/version-1': (route) => json(route, 200, VERSION),
    },
  });
  await page.goto('/checkins/forms');
  await expect(page.getByRole('heading', { level: 1, name: 'Check-in forms' })).toBeFocused();
  await waitForFonts(page);
}

async function axe(page: Page) {
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(
    result.violations.map(
      (violation) =>
        `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).join(', ')}`,
    ),
  ).toEqual([]);
}

const background = (page: Page) =>
  page
    .locator('main')
    .evaluate((main) => getComputedStyle(main).getPropertyValue('--tb-bg').trim());

for (const width of [390, 1440]) {
  test(`check-in forms read as cards and open on their own page at ${width}px`, async ({
    page,
  }) => {
    await open(page, width, LIBRARY);

    await expect(page).toHaveTitle('Check-in forms | TB Gym');
    await expect(page.locator('.lede')).toHaveText(
      '3 forms, 2 ready to assign. Write the questions once, then assign the form from a client’s Check-ins tab.',
    );
    const cards = page.locator('.forms > .cards .card');
    await expect(cards.locator('.card-name')).toHaveText([
      'Weekly check-in',
      'Monthly review',
      'Recovery',
    ]);
    await expect(cards.locator('app-status-pill')).toHaveText([
      'Ready to assign',
      'Draft',
      'Ready to assign',
    ]);
    await expect(cards.nth(2).locator('.note')).toHaveText('Changes not published yet');
    // No picker the browser draws, and no old two-pane page.
    await expect(page.locator('select, input[type="date"]')).toHaveCount(0);
    await expect(page.getByText('Select a form')).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
    await axe(page);
    await page.screenshot({ path: `test-results/a14b-forms-${width}.png`, fullPage: true });

    await page.locator('details.archived > summary').click();
    await expect(page.locator('details.archived .card-name')).toHaveText(['Old intake']);
    await axe(page);

    await cards.first().locator('a.stretched').click();
    await expect(page).toHaveURL('/checkins/forms/form-1');
    await expect(page).toHaveTitle('Check-in form | TB Gym');
    await expect(page.getByRole('heading', { level: 1, name: 'Weekly check-in' })).toBeFocused();
    await expect(page.locator('.question.read .read-prompt')).toHaveText([
      '1. How was your energy this week?',
      '2. How closely did you follow your plan?',
    ]);
    await expect(page.getByRole('button', { name: 'Change the questions' })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await axe(page);
    await page.screenshot({ path: `test-results/a14b-form-${width}.png`, fullPage: true });

    await page.emulateMedia({ colorScheme: 'dark' });
    await expect.poll(() => background(page)).toBe('#0f1513');
    await axe(page);
    await useRtl(page);
    await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
    await expectNoHorizontalOverflow(page);
    await axe(page);
  });

  test(`an empty library starts from a weekly check-in, and the form protects edits at ${width}px`, async ({
    page,
  }) => {
    await open(page, width, []);

    await expect(
      page.getByRole('heading', { level: 2, name: 'No check-in forms yet' }),
    ).toBeVisible();
    await axe(page);
    await page.screenshot({ path: `test-results/a14b-forms-empty-${width}.png`, fullPage: true });
    await page.getByRole('link', { name: 'Start with a weekly check-in' }).click();
    await expect(page).toHaveURL('/checkins/forms/new?start=weekly');
    await expect(page.getByRole('heading', { level: 1, name: 'New check-in form' })).toBeFocused();
    await expect(page.locator('.question')).toHaveCount(6);
    await expect(page.getByLabel('Name', { exact: true })).toHaveValue('Weekly check-in');

    // A change is asked about before the page is left; Stay keeps it.
    await page.getByLabel('Name', { exact: true }).fill('Weekly recovery');
    await page.getByRole('link', { name: 'All check-in forms' }).click();
    const warning = page.getByRole('dialog', { name: 'Leave without saving?' });
    await expect(warning).toBeVisible();
    await warning.getByRole('button', { name: 'Stay', exact: true }).click();
    await expect(page).toHaveURL('/checkins/forms/new?start=weekly');
    await expect(page.getByLabel('Name', { exact: true })).toHaveValue('Weekly recovery');

    // The kit's select changes the kind of answer; nothing on the page is drawn by the browser.
    const first = page.locator('.question').first();
    await kitSelect(first, 'Kind of answer').locator('button.trigger').click();
    await axe(page);
    await page.keyboard.press('Escape');
    await chooseOption(first, 'Kind of answer', 'Choose one');
    await expect(first.locator('.choice')).toHaveCount(2);
    await expect(page.locator('select, input[type="date"], input[type="time"]')).toHaveCount(0);

    // A refused publish says why under the box and takes focus there.
    await first.getByLabel('Question', { exact: true }).fill('');
    await page.getByRole('button', { name: 'Publish', exact: true }).click();
    await expect(first.getByLabel('Question', { exact: true })).toBeFocused();
    await expect(first.getByText('Write the question.')).toBeVisible();
    await expect(page.locator('app-form-summary')).toHaveText('Check what is marked above.');
    await expectNoHorizontalOverflow(page);
    await axe(page);
    await page.screenshot({ path: `test-results/a14b-new-refused-${width}.png`, fullPage: true });

    await page.emulateMedia({ colorScheme: 'dark' });
    await expect.poll(() => background(page)).toBe('#0f1513');
    await axe(page);
    await useRtl(page);
    await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
    await expectNoHorizontalOverflow(page);
    await axe(page);

    await page.getByRole('link', { name: 'All check-in forms' }).click();
    await warning.getByRole('button', { name: 'Leave without saving', exact: true }).click();
    await expect(page).toHaveURL('/checkins/forms');
  });
}
