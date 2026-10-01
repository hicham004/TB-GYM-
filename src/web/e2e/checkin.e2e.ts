import AxeBuilder from '@axe-core/playwright';
import type { Page, Route } from '@playwright/test';
import {
  expect,
  expectNoHorizontalOverflow,
  json,
  mockSession,
  SIGNED_IN_USER,
  test,
  waitForFonts,
} from './support';

const membership = {
  tenantId: '00000000-0000-4000-8000-000000000003',
  tenantName: 'Atlas Performance',
  tenantSlug: 'atlas-performance',
  role: 'Client',
};
const user = {
  ...SIGNED_IN_USER,
  id: '00000000-0000-4000-8000-0000000000bb',
  displayName: 'Maya Fakhoury',
};
const decisions = ['Training', 'Nutrition', 'CheckIns', 'Messaging', 'ResourceLibrary'].map(
  (feature) => ({ feature, isAllowed: true, reason: 'Granted' }),
);

const question = (
  id: string,
  order: number,
  questionType: string,
  prompt: string,
  extra: Record<string, unknown> = {},
) => ({
  id,
  questionKey: id.padEnd(32, '0'),
  order,
  questionType,
  prompt,
  helpText: null,
  isRequired: true,
  scaleMinimum: null,
  scaleMaximum: null,
  scaleStep: null,
  options: [],
  ...extra,
});

// The Atlas demo's weekly check-in (DemoWorkspaceCast.CheckInForm).
const questions = [
  question('a1', 1, 'NumericScale', 'How was your energy this week?', {
    helpText: '1 is exhausted, 10 is unstoppable.',
    scaleMinimum: 1,
    scaleMaximum: 10,
    scaleStep: 1,
  }),
  question('b2', 2, 'SingleChoice', 'How closely did you follow your plan?', {
    options: [
      { id: 'all', order: 1, label: 'All of it' },
      { id: 'most', order: 2, label: 'Most of it' },
      { id: 'half', order: 3, label: 'About half' },
      { id: 'little', order: 4, label: 'Not much this week' },
    ],
  }),
  question('c3', 3, 'LongText', 'What was your biggest win this week?', { isRequired: false }),
];

const assignment = (id: string, dueDate: string) => ({
  id,
  formId: 'form',
  formTitle: 'Weekly check-in',
  formVersionId: 'version',
  formVersionNumber: 1,
  clientProfileId: 'maya',
  dueDate,
  assignedAtUtc: '2026-09-21T06:00:00Z',
  assignedByUserId: 'lea',
});

async function openCheckIns(page: Page, width: number, height: number) {
  let responseVersion = 0;
  let status: 'Draft' | 'Submitted' = 'Draft';
  let answers: unknown[] = [];
  const detail = () => ({
    assignment: assignment('due', '2026-09-27'),
    version: {
      id: 'version',
      formId: 'form',
      formTitle: 'Weekly check-in',
      formDescription: 'Takes two minutes. Be honest: it is how I adjust your plan.',
      versionNumber: 1,
      status: 'Published',
      derivedFromVersionId: null,
      publishedAtUtc: '2026-08-01T08:00:00Z',
      publishedByUserId: 'lea',
      questions,
      version: 1,
    },
    response:
      responseVersion === 0
        ? null
        : {
            id: 'response',
            assignmentId: 'due',
            clientProfileId: 'maya',
            status,
            submittedAtUtc: status === 'Submitted' ? '2026-09-27T17:00:00Z' : null,
            submittedDate: status === 'Submitted' ? '2026-09-27' : null,
            isLate: false,
            reviewedAtUtc: null,
            reviewedByUserId: null,
            answers,
            version: responseVersion,
          },
  });
  const sent = (id: string, dueDate: string, reviewed: boolean, isLate = false) => ({
    assignment: assignment(id, dueDate),
    response: {
      responseId: `r-${id}`,
      status: reviewed ? 'Reviewed' : 'Submitted',
      submittedDate: dueDate,
      submittedAtUtc: `${dueDate}T18:00:00Z`,
      reviewedAtUtc: reviewed ? `${dueDate}T20:00:00Z` : null,
      isLate,
    },
  });

  await page.setViewportSize({ width, height });
  await mockSession(page, {
    memberships: [membership],
    user,
    extra: {
      'GET /api/client-access/me': (route: Route) => json(route, 200, decisions),
      'GET /api/checkins/me/assignments': (route: Route) =>
        json(route, 200, {
          clientProfileId: 'maya',
          total: 4,
          items: [
            { assignment: assignment('due', '2026-09-27'), response: null },
            sent('w3', '2026-09-20', false),
            sent('w2', '2026-09-13', true, true),
            sent('w1', '2026-09-06', true),
          ],
        }),
      'GET /api/checkins/me/assignments/due/response': (route: Route) => json(route, 200, detail()),
      'PUT /api/checkins/me/assignments/due/response': (route: Route) => {
        const body = route.request().postDataJSON();
        answers = body.answers.map((answer: Record<string, unknown>) => {
          const source = questions.find((item) => item.id === answer['questionId'])!;
          return {
            questionId: source.id,
            questionKey: source.questionKey,
            questionType: source.questionType,
            textValue: answer['textValue'],
            numericValue: answer['numericValue'],
            choices: (answer['selectedOptionIds'] as string[]).map((id) => ({
              questionOptionId: id,
              label: (source.options as { id: string; label: string }[]).find(
                (option) => option.id === id,
              )!.label,
              order: 1,
            })),
          };
        });
        responseVersion++;
        return json(route, 200, detail());
      },
      'POST /api/checkins/me/assignments/due/response/submit': (route: Route) => {
        status = 'Submitted';
        return json(route, 200, detail());
      },
      'GET /api/progress/me/photos': (route: Route) =>
        json(route, 200, {
          clientProfileId: 'maya',
          from: '2026-07-06',
          toExclusive: '2026-09-28',
          photos: [],
        }),
      'GET /api/client-profile/me/coach': (route: Route) =>
        json(route, 200, { name: 'Lea Haddad' }),
    },
  });
  await page.goto('/checkins/me');
  await expect(page.getByRole('heading', { name: 'Check-ins', level: 1 })).toBeVisible();
  await expect(page.getByText('3 questions')).toBeVisible();
  await waitForFonts(page);
}

async function axe(page: Page) {
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
    .analyze();
  expect(
    result.violations.map(
      (violation) =>
        `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).join(', ')}`,
    ),
  ).toEqual([]);
}

/** Every screen of the journey: axe, no sideways scroll, and a screenshot for the owner's review. */
async function check(page: Page, name: string, width: number) {
  await expectNoHorizontalOverflow(page);
  await axe(page);
  await page.screenshot({ path: `test-results/r24c-checkin-${name}-${width}.png`, fullPage: true });
}

for (const [width, height] of [
  [390, 844],
  [1440, 900],
] as const) {
  test(`a check-in at ${width}px goes question by question to a sent confirmation`, async ({
    page,
  }) => {
    await openCheckIns(page, width, height);
    await check(page, 'home', width);
    await expect(page.getByText('Waiting for your coach')).toBeVisible();
    await expect(page.getByText('after the due date')).toBeVisible();

    await page.getByRole('link', { name: 'Start check-in' }).click();
    await expect(
      page.getByRole('heading', { name: 'How was your energy this week?' }),
    ).toBeFocused();
    await expect(page.getByText('Question 1 of 3')).toBeVisible();
    await page.getByRole('radio', { name: '8' }).check();
    await check(page, 'question', width);

    await page.getByRole('button', { name: 'Next' }).click();
    await page.getByRole('radio', { name: 'Most of it' }).check();
    await check(page, 'choice', width);
    await page.getByRole('button', { name: 'Next' }).click();

    await page
      .getByRole('textbox', { name: 'What was your biggest win this week?' })
      .fill('Deadlifts flew. The last set was an easy 8.');
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page.getByRole('heading', { name: "Add this week's photos" })).toBeFocused();
    await check(page, 'photos', width);
    await page.getByRole('button', { name: 'Skip photos' }).click();

    await expect(page.getByRole('heading', { name: 'Check your answers' })).toBeFocused();
    await expect(page.getByText('8 out of 10')).toBeVisible();
    await check(page, 'review', width);
    await page.getByRole('button', { name: 'Send check-in' }).click();

    await expect(page.getByRole('heading', { name: 'Sent to Lea Haddad' })).toBeFocused();
    await check(page, 'sent', width);
  });
}

test('a question works from the keyboard and reflows at 200% text', async ({ page }) => {
  await openCheckIns(page, 390, 844);
  await page.getByRole('link', { name: 'Start check-in' }).click();
  await expect(page.getByRole('heading', { name: 'How was your energy this week?' })).toBeFocused();

  await page.keyboard.press('Tab');
  await expect(page.getByRole('radio', { name: '1', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('radio', { name: '3', exact: true })).toBeChecked();

  await page.evaluate(() => (document.documentElement.style.fontSize = '200%'));
  await expectNoHorizontalOverflow(page);
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByText('Question 2 of 3')).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test('an unanswered required question says why instead of moving on', async ({ page }) => {
  await openCheckIns(page, 390, 844);
  await page.getByRole('link', { name: 'Start check-in' }).click();
  await page.getByRole('button', { name: 'Next' }).click();

  await expect(page.getByText('This question has to be answered.')).toBeVisible();
  await expect(page.getByRole('radiogroup')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByText('Question 1 of 3')).toBeVisible();
});
