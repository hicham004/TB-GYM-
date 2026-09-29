import AxeBuilder from '@axe-core/playwright';
import type { Page, Route } from '@playwright/test';
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
 * The migrated exercise library (Figma 266:1429): its states, its server-side filters, its table,
 * and the confirmation that stands between Archive and the endpoint. Everything is answered by
 * per-test mocks; the guards, the tenant header and the antiforgery flow run unchanged.
 */
interface ExerciseOptions {
  archived?: boolean;
  tags?: string[];
  muscle?: string;
  equipment?: string;
  pattern?: string;
  classification?: string;
}

function exercise(id: number, name: string, options: ExerciseOptions = {}) {
  return {
    id: `00000000-0000-4000-8000-${String(id).padStart(12, '0')}`,
    name,
    instructions: null,
    equipment: options.equipment ?? 'Barbell',
    movementPattern: options.pattern ?? 'Squat',
    classification: options.classification ?? 'Strength',
    isArchived: options.archived ?? false,
    muscles: [{ muscle: options.muscle ?? 'Quadriceps', role: 'Primary' }],
    tags: options.tags ?? [],
    alternatives: [],
    mediaAssetIds: [],
    version: 7,
  };
}

const LIBRARY = [
  exercise(1, 'Banded pull-apart', {
    archived: true,
    tags: ['warm-up'],
    muscle: 'Shoulders',
    equipment: 'Band',
    pattern: 'HorizontalPull',
    classification: 'General',
  }),
  exercise(2, 'Barbell back squat', { tags: ['compound'] }),
  exercise(3, 'Barbell bench press', {
    tags: ['compound', 'press'],
    muscle: 'Chest',
    pattern: 'HorizontalPush',
  }),
  exercise(4, 'Cable face pull', {
    tags: ['shoulder health'],
    muscle: 'Shoulders',
    equipment: 'Cable',
    pattern: 'HorizontalPull',
    classification: 'General',
  }),
  exercise(5, 'Farmer’s carry', {
    tags: ['grip', 'finisher'],
    muscle: 'Forearms',
    equipment: 'Dumbbell',
    pattern: 'Carry',
    classification: 'Conditioning',
  }),
  exercise(6, 'Half-kneeling single-arm landmine press', {
    muscle: 'Shoulders',
    pattern: 'VerticalPush',
  }),
  exercise(7, 'Kettlebell swing', {
    tags: ['power'],
    muscle: 'Glutes',
    equipment: 'Kettlebell',
    pattern: 'Hinge',
    classification: 'Conditioning',
  }),
  exercise(8, 'Mobility flow', {
    muscle: 'FullBody',
    equipment: 'None',
    classification: 'Mobility',
  }),
  exercise(9, 'Romanian deadlift', { tags: ['hinge'], muscle: 'Hamstrings', pattern: 'Hinge' }),
  exercise(10, 'Weighted pull-up', {
    tags: ['vertical'],
    muscle: 'Back',
    equipment: 'Bodyweight',
    pattern: 'VerticalPull',
  }),
];

const NO_MEDIA = (route: Route) => json(route, 200, { total: 0, skip: 0, take: 100, items: [] });

async function openLibrary(
  page: Page,
  options: {
    width?: number;
    height?: number;
    rtl?: boolean;
    items?: ReturnType<typeof exercise>[];
    total?: number;
    status?: number;
    /** Lets a test refuse reads from a point onwards, as a search can be refused. */
    refuseWhen?: () => boolean;
    onSearch?: (url: URL) => void;
    archiveResponse?: (route: Route) => void;
  } = {},
) {
  const items = options.items ?? LIBRARY;
  await page.setViewportSize({ width: options.width ?? 1440, height: options.height ?? 900 });
  await mockSession(page, {
    extra: {
      'GET /api/exercises': (route) => {
        options.onSearch?.(new URL(route.request().url()));
        const refused = (options.status ?? 0) >= 400 || (options.refuseWhen?.() ?? false);
        return refused
          ? json(route, options.status ?? 500, {})
          : json(route, 200, { total: options.total ?? items.length, items });
      },
      'GET /api/media': NO_MEDIA,
      'PUT /api/exercises/00000000-0000-4000-8000-000000000002/archive': (route) =>
        options.archiveResponse
          ? options.archiveResponse(route)
          : json(
              route,
              200,
              items.find((item) => item.name === 'Barbell back squat'),
            ),
      'PUT /api/exercises/00000000-0000-4000-8000-000000000001/archive': (route) =>
        json(route, 200, items[0]),
    },
  });
  await page.goto('/training/exercises');
  await expect(page.getByRole('heading', { level: 1, name: 'Training' })).toBeVisible();
  if (options.rtl) await useRtl(page);
  await waitForFonts(page);
}

const table = (page: Page) => page.locator('table.tb-table');

test('the populated library matches the approved screen', async ({ page }) => {
  await openLibrary(page);

  await expect(page.locator('.summary')).toHaveText('10 exercises · sorted by name');
  await expect(table(page).locator('tbody tr')).toHaveCount(10);
  await expectNoHorizontalOverflow(page);
  await expect(page).toHaveScreenshot('exercises-1440-ltr.png');
});

test('the library reads correctly in RTL, with the count isolated', async ({ page }) => {
  await openLibrary(page, { rtl: true });

  await expectNoHorizontalOverflow(page);
  // The table itself never scrolls sideways either.
  const overflow = await page
    .locator('.rows-scroll')
    .evaluate((element) => element.scrollWidth - element.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await expect(page).toHaveScreenshot('exercises-1440-rtl.png');
});

test('at 390px the rows stack and stay a table for assistive technology', async ({ page }) => {
  await openLibrary(page, { width: 390, height: 844 });

  await expectNoHorizontalOverflow(page);
  // Column headers are off-screen, and each cell carries its own label instead.
  expect(
    await page.locator('thead').evaluate((element) => element.getBoundingClientRect().height),
  ).toBeLessThanOrEqual(1);
  await expect(page.locator('tbody tr').first().locator('.tb-table__label').first()).toBeVisible();
  const roles = await page.evaluate(() => {
    const row = document.querySelector('tbody tr')!;
    return {
      table: document.querySelector('table')?.getAttribute('role'),
      row: row.getAttribute('role'),
      cell: row.querySelector('td')?.getAttribute('role'),
      header: document.querySelector('thead th')?.getAttribute('role'),
    };
  });
  expect(roles).toEqual({ table: 'table', row: 'row', cell: 'cell', header: 'columnheader' });
  await expect(page).toHaveScreenshot('exercises-390-ltr.png', { fullPage: true });
});

test('the loading, empty and error states each say what is happening', async ({ page }) => {
  // Loading: the response is held open while the first render is inspected.
  let release: (() => void) | undefined;
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockSession(page, {
    extra: {
      'GET /api/exercises': async (route) => {
        await new Promise<void>((resolve) => (release = resolve));
        return json(route, 200, { total: 0, items: [] });
      },
      'GET /api/media': NO_MEDIA,
    },
  });
  await page.goto('/training/exercises');
  await expect(page.getByText('Loading exercises…')).toBeVisible();
  release?.();

  await expect(page.getByText('No exercises found')).toBeVisible();
  await expect(page.getByText('Clear the search or widen the filters.')).toBeVisible();
  await expect(page.locator('.summary')).toHaveText('No exercises');
  await expect(page).toHaveScreenshot('exercises-empty-1440.png');
});

test.describe('a refused search', () => {
  // The browser logs the refused request itself. Anything else — an Angular ERROR from a rejection
  // nobody handled, or an uncaught page error — fails this test through the guard in support.ts.
  test.use({
    allowedConsoleErrors: { patterns: [/status of 401 .*\/api\/auth\/me/, /status of 500/] },
  });

  test('is reported in the list, raises no uncaught error, and can be retried', async ({
    page,
  }) => {
    const requests: URL[] = [];
    const server = { refusing: false };
    await openLibrary(page, {
      refuseWhen: () => server.refusing,
      onSearch: (url) => requests.push(url),
    });
    await expect(table(page).locator('tbody tr')).toHaveCount(10);

    server.refusing = true;
    await page.getByLabel('Equipment').selectOption('Kettlebell');
    await page.getByRole('button', { name: 'Apply' }).click();

    const alert = page.locator('.list-error');
    await expect(alert).toHaveAttribute('role', 'alert');
    await expect(alert).toContainText('The exercise library could not be loaded.');
    // Rows read for the previous filters are not left standing as the answer to these ones.
    await expect(table(page)).toHaveCount(0);
    await expect(page.locator('.summary')).toBeEmpty();
    // Apply is operable again, so the failure is recoverable rather than a dead screen.
    await expect(page.getByRole('button', { name: 'Apply' })).not.toHaveAttribute(
      'aria-disabled',
      'true',
    );

    // Enter in the search field takes the same path, and is refused the same way.
    await page.getByLabel('Search exercises').fill('squat');
    await page.getByLabel('Search exercises').press('Enter');
    await expect(alert).toBeVisible();
    expect(requests.at(-1)?.searchParams.get('query')).toBe('squat');

    // Try again repeats the filters the refused request used, and recovers.
    server.refusing = false;
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(alert).toHaveCount(0);
    await expect(table(page).locator('tbody tr')).toHaveCount(10);
    expect(requests.at(-1)?.searchParams.get('equipment')).toBe('Kettlebell');
    expect(requests.at(-1)?.searchParams.get('query')).toBe('squat');
  });
});

test.describe('a failed list read', () => {
  // The browser logs the 500 this state is about, exactly as it would against the real API.
  test.use({
    allowedConsoleErrors: { patterns: [/status of 401 .*\/api\/auth\/me/, /status of 500/] },
  });

  test('is reported in an alert, leaves the summary empty and can be retried', async ({ page }) => {
    await openLibrary(page, { status: 500 });

    const alert = page.locator('.list-error');
    await expect(alert).toHaveAttribute('role', 'alert');
    await expect(alert).toContainText('The exercise library could not be loaded.');
    await expect(page.locator('.summary')).toBeEmpty();
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
    await expect(page).toHaveScreenshot('exercises-error-1440.png');
  });
});

test('more matches than rows are reported honestly', async ({ page }) => {
  const many = Array.from({ length: 100 }, (_, index) =>
    exercise(index + 20, `Exercise ${String(index + 1).padStart(3, '0')}`),
  );
  await openLibrary(page, { items: many, total: 134 });

  await expect(page.locator('.summary')).toHaveText(
    'Showing the first 100 of 134. Refine the search.',
  );
  await expect(table(page).locator('tbody tr')).toHaveCount(100);
  // The rows scroll inside the card; the toolbar and the column headers stay.
  const scrolled = await page.locator('.rows-scroll').evaluate((element) => {
    element.scrollTo(0, 600);
    return element.scrollTop;
  });
  expect(scrolled).toBeGreaterThan(0);
  await expect(page.locator('thead th').first()).toBeInViewport();
  await expect(page.locator('.summary')).toBeInViewport();
});

test('the request asks for at most 100 rows', async ({ page }) => {
  const requests: URL[] = [];
  await openLibrary(page, { onSearch: (url) => requests.push(url) });

  expect(requests.length).toBeGreaterThan(0);
  expect(requests[0].searchParams.get('take')).toBe('100');
  expect(requests[0].searchParams.get('skip')).toBe('0');
});

test('Apply and Enter both run the search, a select on its own does not', async ({ page }) => {
  const requests: URL[] = [];
  await openLibrary(page, { onSearch: (url) => requests.push(url) });
  requests.length = 0;

  await page.getByLabel('Equipment').selectOption('Kettlebell');
  await page.waitForTimeout(150);
  expect(requests).toHaveLength(0);

  await page.getByRole('button', { name: 'Apply' }).click();
  await expect.poll(() => requests.length).toBe(1);
  expect(requests[0].searchParams.get('equipment')).toBe('Kettlebell');

  await page.getByLabel('Search exercises').fill('squat');
  await page.getByLabel('Search exercises').press('Enter');
  await expect.poll(() => requests.length).toBe(2);
  expect(requests[1].searchParams.get('query')).toBe('squat');
  expect(requests[1].searchParams.get('includeArchived')).toBe('false');

  await page.getByLabel('Include archived').check();
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect.poll(() => requests.length).toBe(3);
  expect(requests[2].searchParams.get('includeArchived')).toBe('true');
});

test('archiving asks first, and Cancel sends nothing', async ({ page }) => {
  const archiveRequests: string[] = [];
  await openLibrary(page, {
    archiveResponse: (route) => {
      archiveRequests.push(route.request().postData() ?? '');
      return json(route, 200, LIBRARY[1]);
    },
  });

  const archive = page.getByRole('button', { name: 'Archive Barbell back squat' });
  await archive.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Archive Barbell back squat?');
  await expect(page).toHaveScreenshot('exercises-archive-dialog-1440.png');

  const scan = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
    .analyze();
  expect(scan.violations.map((violation) => `${violation.id}: ${violation.nodes.length}`)).toEqual(
    [],
  );

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(archive).toBeFocused();
  expect(archiveRequests).toHaveLength(0);

  await archive.click();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
  await expect(archive).toBeFocused();
  expect(archiveRequests).toHaveLength(0);
});

test('confirming archives once and says so', async ({ page }) => {
  const archiveRequests: string[] = [];
  await openLibrary(page, {
    archiveResponse: (route) => {
      archiveRequests.push(route.request().postData() ?? '');
      return json(route, 200, LIBRARY[1]);
    },
  });

  await page.getByRole('button', { name: 'Archive Barbell back squat' }).click();
  await page.getByRole('button', { name: 'Archive exercise' }).click();

  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.locator('.page-notice')).toHaveText('Exercise archived.');
  expect(archiveRequests).toHaveLength(1);
  expect(JSON.parse(archiveRequests[0])).toEqual({ isArchived: true, version: 7 });
});

test('restoring needs no confirmation', async ({ page }) => {
  await openLibrary(page);

  await page.getByRole('button', { name: 'Restore Banded pull-apart' }).click();

  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.locator('.page-notice')).toHaveText('Exercise restored.');
});

test('an archived row offers Restore and never Edit', async ({ page }) => {
  await openLibrary(page);

  const archivedRow = table(page).locator('tbody tr').first();
  await expect(archivedRow).toContainText('Archived');
  await expect(archivedRow).toContainText('Not in new programs');
  await expect(archivedRow.getByRole('button')).toHaveText([/Restore/]);
});

test('focus rings are visible and unclipped on the first and last rows', async ({ page }) => {
  await openLibrary(page);

  for (const target of [
    page.getByRole('button', { name: 'Restore Banded pull-apart' }),
    page.getByRole('button', { name: 'Archive Weighted pull-up' }),
  ]) {
    await target.focus();
    const ring = await target.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        outline: `${style.outlineStyle} ${style.outlineWidth} ${style.outlineColor}`,
        offset: style.outlineOffset,
      };
    });
    expect(ring).toEqual({ outline: 'solid 3px rgb(21, 61, 51)', offset: '2px' });

    const box = (await target.boundingBox())!;
    const region = (await page.locator('.rows-scroll').boundingBox())!;
    expect(box.y - 5).toBeGreaterThanOrEqual(region.y - 0.5);
    expect(box.y + box.height + 5).toBeLessThanOrEqual(region.y + region.height + 0.5);
  }
});

test('the library has no axe violations at 1440 and 390', async ({ page }) => {
  for (const width of [1440, 390]) {
    await openLibrary(page, { width, height: width === 390 ? 844 : 900 });
    const scan = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
      .analyze();
    expect(
      scan.violations.map((violation) => `${violation.id}: ${violation.nodes.length}`),
      `axe at ${width}px`,
    ).toEqual([]);
  }
});

test('200% text reflows the library without sideways scrolling', async ({ page }) => {
  await openLibrary(page);
  await page.evaluate(() => (document.documentElement.style.fontSize = '32px'));

  await expectNoHorizontalOverflow(page);
  // Enlarged text stacks the rows rather than squeezing seven columns.
  await expect(page.locator('tbody tr').first().locator('.tb-table__label').first()).toBeVisible();
  await expect(page).toHaveScreenshot('exercises-1440-200-percent.png', { fullPage: true });
});

test('New exercise is the only dominant action and opens the existing editor', async ({ page }) => {
  await openLibrary(page);

  await expect(page.locator('.tb-button--filled')).toHaveText(['New exercise']);
  await page.getByRole('button', { name: 'New exercise' }).click();

  await expect(page.locator('.editor-section')).toBeVisible();
  await expect(page.locator('.media-section')).toBeVisible();
});
