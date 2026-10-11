import AxeBuilder from '@axe-core/playwright';
import type { Page, Route } from '@playwright/test';
import { contrast } from '../src/app/core/theme/color';
import {
  answers,
  earlierDetail,
  listItemOf,
  QUESTIONS,
  reviewDetail,
  type AnswerSet,
} from '../src/testing/checkin-review-fixtures';
import { coachTodayView } from '../src/testing/coach-today-fixtures';
import { historyPage, programView } from '../src/testing/training-program-fixtures';
import {
  expect,
  expectNoHorizontalOverflow,
  json,
  mockSession,
  mockSignedOut,
  SIGNED_IN_USER,
  test,
  waitForFonts,
} from './support';

const MODES = ['light', 'dark'] as const;
const PRESETS = [
  { id: 'forest', brand: '#153d33' },
  { id: 'navy', brand: '#15233f' },
  { id: 'charcoal', brand: '#221b18' },
  { id: 'plum', brand: '#36203a' },
] as const;

test('the default lab uses TB Gym forest and cream', async ({ page }) => {
  await mockSignedOut(page);
  await page.goto('/dev/ui-lab');
  const colors = await page.locator('app-ui-lab').evaluate((lab) => {
    const button = lab.querySelector('.tb-button--filled')!;
    return {
      button: getComputedStyle(button).backgroundColor,
      background: getComputedStyle(lab).backgroundColor,
    };
  });
  expect(colors).toEqual({ button: 'rgb(21, 61, 51)', background: 'rgb(251, 250, 245)' });
});

async function themeColors(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    const value = (name: string) => root.getPropertyValue(name).trim();
    return {
      brand: value('--tb-brand'),
      onBrand: value('--tb-on-brand'),
      onBrandMuted: value('--tb-on-brand-muted'),
      accent: value('--tb-accent'),
      onAccent: value('--tb-on-accent'),
      accentBright: value('--tb-accent-bright'),
      bg: value('--tb-bg'),
      surface: value('--tb-surface'),
      ink: value('--tb-ink'),
      muted: value('--tb-muted'),
    };
  });
}

for (const preset of PRESETS) {
  for (const mode of MODES) {
    test(`${preset.id} ${mode}: lab and both shells keep AA contrast at phone and desktop widths`, async ({
      page,
    }) => {
      const query = `?brand=${preset.id}&mode=${mode}`;
      await mockSignedOut(page);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`/dev/ui-lab${query}`);
      await expect(page.getByRole('heading', { name: 'UI lab' })).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('data-mode', mode);
      await waitForFonts(page);

      const colors = await themeColors(page);
      expect(colors.brand).toBe(preset.brand);
      expect(contrast(colors.brand, colors.onBrand)).toBeGreaterThanOrEqual(7);
      expect(contrast(colors.brand, colors.onBrandMuted)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(colors.accent, colors.onAccent)).toBeGreaterThanOrEqual(4.5);
      for (const surface of [colors.bg, colors.surface]) {
        expect(contrast(surface, colors.ink)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(surface, colors.muted)).toBeGreaterThanOrEqual(4.5);
      }
      await expectNoHorizontalOverflow(page);
      const labScan = await new AxeBuilder({ page })
        .include('app-ui-lab')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze();
      expect(labScan.violations.map((violation) => violation.id)).toEqual([]);
      await page.screenshot({ path: test.info().outputPath('lab-390.png'), fullPage: true });
      await page.setViewportSize({ width: 1440, height: 900 });
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: test.info().outputPath('lab-1440.png'), fullPage: true });

      await mockSession(page, {
        extra: {
          // A full Coach Today, so every tag, badge and bar is checked in this brand and mode.
          'GET /api/coach-today': (route) => json(route, 200, coachTodayView()),
        },
      });
      await page.goto(`/${query}`);
      await expect(page.locator('app-coach-shell')).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('data-mode', mode);
      await waitForFonts(page);
      await expectNoHorizontalOverflow(page);
      const shellScan = await new AxeBuilder({ page })
        .include('app-coach-shell')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze();
      expect(shellScan.violations.map((violation) => violation.id)).toEqual([]);
      await page.screenshot({ path: test.info().outputPath('shell-1440.png'), fullPage: true });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.getByRole('button', { name: 'Menu', exact: true }).click();
      await expect(page.locator('#coach-navigation-dialog')).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: test.info().outputPath('shell-390.png'), fullPage: true });

      await mockSession(page, {
        memberships: [
          {
            tenantId: '00000000-0000-4000-8000-000000000003',
            tenantName: 'Atlas Performance',
            tenantSlug: 'atlas-performance',
            role: 'Client',
          },
        ],
        extra: {
          'GET /api/client-access/me': (route) => json(route, 200, []),
          'GET /api/client-profile/me/coach': (route) =>
            json(route, 200, { name: 'Hicham Haddad' }),
        },
      });
      await page.goto(`/me${query}`);
      await expect(page.locator('app-client-tabs')).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('data-mode', mode);
      await expectNoHorizontalOverflow(page);
      const clientScan = await new AxeBuilder({ page })
        .include('app-client-tabs')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze();
      expect(clientScan.violations.map((violation) => violation.id)).toEqual([]);
      await page.screenshot({
        path: test.info().outputPath('client-shell-390.png'),
        fullPage: true,
      });
      await page.setViewportSize({ width: 1440, height: 900 });
      await expectNoHorizontalOverflow(page);
      await page.screenshot({
        path: test.info().outputPath('client-shell-1440.png'),
        fullPage: true,
      });
    });
  }
}

// The client's own screens (R5.4b): Today, Training and Check-ins follow the person's mode. The
// device asks for dark and the account is on "system", as on a phone set to dark.
const CLIENT = {
  tenantId: '00000000-0000-4000-8000-000000000003',
  tenantName: 'Atlas Performance',
  tenantSlug: 'atlas-performance',
  role: 'Client',
};
const MAYA_USER = {
  ...SIGNED_IN_USER,
  id: '00000000-0000-4000-8000-0000000000bb',
  displayName: 'Maya Fakhoury',
};
const CLIENT_TODAY = '2026-10-04';
const GRANTED = ['Training', 'Nutrition', 'CheckIns', 'Messaging', 'ResourceLibrary'].map(
  (feature) => ({ feature, isAllowed: true, reason: 'Granted' }),
);
// The due check-in asks the choice first, then a scale, so both chosen states are one step apart.
const DUE_QUESTIONS = [
  { ...QUESTIONS[3], order: 1 },
  { ...QUESTIONS[0], order: 2 },
];

async function mockClient(page: Page): Promise<void> {
  const due = reviewDetail({
    id: 'due',
    status: null,
    dueDate: '2026-10-07',
    questions: DUE_QUESTIONS,
  });
  let saved: AnswerSet = {};
  let version = 0;
  const dueDetail = () =>
    version === 0
      ? due
      : {
          ...due,
          response: {
            id: 'response-due',
            assignmentId: 'due',
            clientProfileId: due.assignment.clientProfileId,
            status: 'Draft',
            submittedAtUtc: null,
            submittedDate: null,
            isLate: false,
            reviewedAtUtc: null,
            reviewedByUserId: null,
            answers: answers(saved, DUE_QUESTIONS),
            version,
            answersWithheld: false,
          },
        };
  const sessions = (count: number) => Array.from({ length: count }, () => ({ isCompleted: false }));
  await mockSession(page, {
    memberships: [CLIENT],
    user: MAYA_USER,
    extra: {
      'GET /api/client-access/me': (route: Route) => json(route, 200, GRANTED),
      'GET /api/client-profile/me/coach': (route: Route) =>
        json(route, 200, { name: 'Lea Haddad' }),
      'GET /api/client-renewal/me': (route: Route) =>
        json(route, 200, {
          planEnded: false,
          endedOn: null,
          coachName: null,
          lastRequest: null,
          canAsk: false,
        }),
      'GET /api/training/me/today': (route: Route) =>
        json(route, 200, {
          isAllowed: true,
          accessReason: 'Granted',
          localDate: CLIENT_TODAY,
          workouts: [
            {
              sessionId: 'session-a',
              mesocycleId: 'block',
              workoutExecutionId: null,
              name: 'Lower A',
              coachNotes: 'Two warm-up sets, then the working sets.',
              status: null,
              exercises: [{ sets: sessions(3) }, { sets: sessions(3) }, { sets: sessions(3) }],
              notes: [],
              executionVersion: null,
            },
          ],
        }),
      'GET /api/training/me/upcoming': (route: Route) =>
        json(route, 200, {
          isAllowed: true,
          accessReason: 'Granted',
          localDate: CLIENT_TODAY,
          timeZoneId: 'Asia/Beirut',
          hasAssignedProgram: true,
          hasVisibleSessions: true,
          searchThrough: '2026-12-31',
          nextSession: null,
          unfinishedWorkouts: [],
          nextSkip: null,
          todayCoverage: {
            activeBlock: {
              id: 'block',
              name: 'Lean & Strong',
              weekNumber: 4,
              weekCount: 6,
              isCurrentWeekPublished: true,
            },
            nextBlockStartDate: null,
          },
        }),
      'GET /api/training/me/week': (route: Route) =>
        json(route, 200, {
          isAllowed: true,
          accessReason: 'Granted',
          localDate: CLIENT_TODAY,
          weekStart: '2026-09-28',
          days: ['28', '29', '30', '01', '02', '03', '04'].map((date, index) => ({
            date: index < 3 ? `2026-09-${date}` : `2026-10-${date}`,
            scheduled: [0, 2, 4, 6].includes(index) ? 1 : 0,
            completed: [0, 2, 4].includes(index) ? 1 : 0,
          })),
        }),
      'GET /api/nutrition/me/day': (route: Route) =>
        json(route, 200, {
          planId: 'plan',
          planDayId: 'plan-day',
          date: CLIENT_TODAY,
          targetCalories: 2150,
          targetProteinGrams: 130,
          targetCarbohydrateGrams: 230,
          targetFatGrams: 70,
          dailyLogId: 'log',
          dailyLogVersion: 1,
          logStatus: 'InProgress',
          selectedCalories: 610,
          selectedProteinGrams: 40,
          selectedCarbohydrateGrams: 70,
          selectedFatGrams: 18,
          slots: ['Breakfast', 'Lunch', 'Snack', 'Dinner'].map((name, order) => ({
            id: `slot-${order}`,
            name,
            order,
            choices: [],
            selectedChoiceId: order === 0 ? 'choice-0' : null,
            actualServings: null,
          })),
          safetyNotice: 'General guidance only.',
        }),
      'GET /api/messaging/conversations': (route: Route) =>
        json(route, 200, {
          items: [],
          hasMore: false,
          nextBeforeActivityAtUtc: null,
          nextBeforeConversationId: null,
        }),
      'GET /api/training/me/program': (route: Route) => json(route, 200, programView()),
      'GET /api/training/me/history': (route: Route) => json(route, 200, historyPage()),
      'GET /api/checkins/me/assignments': (route: Route) => {
        const items = [listItemOf(dueDetail()), listItemOf(earlierDetail())];
        return json(route, 200, {
          clientProfileId: due.assignment.clientProfileId,
          total: items.length,
          items,
        });
      },
      'GET /api/checkins/me/assignments/due/response': (route: Route) =>
        json(route, 200, dueDetail()),
      // A draft save answers with what was saved, as the API does.
      'PUT /api/checkins/me/assignments/due/response': (route: Route) => {
        const body = route.request().postDataJSON() as {
          answers: {
            questionId: string;
            textValue: string | null;
            numericValue: number | null;
            selectedOptionIds: string[];
          }[];
        };
        saved = {};
        for (const answer of body.answers) {
          const item = DUE_QUESTIONS.find((candidate) => candidate.id === answer.questionId)!;
          const option = item.options.find((candidate) =>
            answer.selectedOptionIds.includes(candidate.id),
          );
          const value = option?.label ?? answer.numericValue ?? answer.textValue;
          if (value !== null && value !== undefined)
            Object.assign(saved, { [item.questionKey]: value });
        }
        version++;
        return json(route, 200, dueDetail());
      },
      'GET /api/progress/me/photos': (route: Route) =>
        json(route, 200, {
          clientProfileId: due.assignment.clientProfileId,
          from: '2026-07-13',
          toExclusive: '2026-10-05',
          photos: [],
        }),
    },
  });
}

/** In the person's dark mode, not forced light, reflowing and clean to the axe scan (contrast included). */
async function expectDarkPage(page: Page): Promise<void> {
  await waitForFonts(page);
  const mode = await page.evaluate(() => {
    const main = document.querySelector('main')!;
    return {
      forced: main.getAttribute('data-mode'),
      background: getComputedStyle(main).getPropertyValue('--tb-bg').trim(),
    };
  });
  expect(mode).toEqual({ forced: null, background: '#0f1513' });
  await expectNoHorizontalOverflow(page);
  const scan = await new AxeBuilder({ page })
    .include('main')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(
    scan.violations.map(
      (violation) =>
        `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).join(', ')}`,
    ),
  ).toEqual([]);
}

/** How far a chosen answer's colour stands from the card it sits on (WCAG 1.4.11 asks 3:1). */
async function standsOut(
  page: Page,
  selector: string,
  property: 'backgroundColor' | 'borderTopColor',
) {
  const colors = await page.evaluate(
    ([target, key]) => {
      const hex = (value: string) =>
        `#${(value.match(/\d+(\.\d+)?/g) ?? [])
          .slice(0, 3)
          .map((part) => Math.round(Number(part)).toString(16).padStart(2, '0'))
          .join('')}`;
      return {
        chosen: hex(getComputedStyle(document.querySelector(target)!)[key]),
        card: hex(getComputedStyle(document.querySelector('.step')!).backgroundColor),
      };
    },
    [selector, property] as const,
  );
  return contrast(colors.chosen, colors.card);
}

for (const [width, height] of [
  [390, 844],
  [1440, 900],
] as const) {
  test(`at ${width}px the client’s Today, Training and Check-ins follow dark mode`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ colorScheme: 'dark' });
    await mockClient(page);

    await page.goto('/');
    await expect(page.locator('#today-training-heading')).toHaveText('Lower A');
    await expect(page.locator('.row-skeleton')).toHaveCount(0);
    await expect(page.locator('html')).toHaveAttribute('data-mode', 'system');
    await expectDarkPage(page);
    await page.screenshot({ path: test.info().outputPath(`client-today-dark-${width}.png`) });

    await page.goto('/training/program');
    await expect(page.getByRole('heading', { name: 'Training', level: 1 })).toBeVisible();
    await expect(page.getByText('Personal record:')).toBeAttached();
    await expectDarkPage(page);
    await page.screenshot({ path: test.info().outputPath(`client-training-dark-${width}.png`) });

    await page.goto('/checkins/me');
    await expect(page.getByRole('heading', { name: 'Check-ins', level: 1 })).toBeVisible();
    await expect(page.getByText('2 questions')).toBeVisible();
    await expectDarkPage(page);
    await page.screenshot({ path: test.info().outputPath(`client-checkins-dark-${width}.png`) });

    // A chosen answer was drawn in the brand colour, which all but vanishes on a dark card.
    await page.getByRole('link', { name: /Start check-in/ }).click();
    await expect(page.locator('.step-title')).toHaveText('How closely did you follow your plan?');
    await page.locator('.option').filter({ hasText: 'All of it' }).click();
    await expect(page.getByRole('radio', { name: 'All of it' })).toBeChecked();
    await page.mouse.move(0, 0);
    expect(
      await standsOut(page, '.option:has(:checked) > .option-mark', 'backgroundColor'),
    ).toBeGreaterThanOrEqual(3);
    expect(await standsOut(page, '.option:has(:checked)', 'borderTopColor')).toBeGreaterThanOrEqual(
      3,
    );
    await expectDarkPage(page);
    await page.screenshot({
      path: test.info().outputPath(`client-checkin-choice-dark-${width}.png`),
    });

    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page.locator('.step-title')).toHaveText('How was your energy this week?');
    await page.locator('.scale-chip').filter({ hasText: /^7$/ }).click();
    await expect(page.getByRole('radio', { name: '7' })).toBeChecked();
    await page.mouse.move(0, 0);
    expect(
      await standsOut(page, '.scale-chip:has(:checked) > span', 'backgroundColor'),
    ).toBeGreaterThanOrEqual(3);
    await expectDarkPage(page);
    await page.screenshot({
      path: test.info().outputPath(`client-checkin-scale-dark-${width}.png`),
    });
  });
}

test('system mode follows the device and updates legacy aliases in the same scope', async ({
  page,
}) => {
  await mockSignedOut(page);
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/dev/ui-lab?mode=system');
  await expect(page.locator('html')).toHaveAttribute('data-mode', 'system');
  const background = () =>
    page.evaluate(() => {
      const style = getComputedStyle(document.documentElement);
      return [
        style.getPropertyValue('--tb-bg').trim(),
        style.getPropertyValue('--color-background').trim(),
      ];
    });
  await expect.poll(background).toEqual(['#0f1513', '#0f1513']);
  await page.emulateMedia({ colorScheme: 'light' });
  await expect.poll(background).toEqual(['#fbfaf5', '#fbfaf5']);
});
