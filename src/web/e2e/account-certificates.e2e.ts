import AxeBuilder from '@axe-core/playwright';
import type { Locator, Page, Route } from '@playwright/test';
import {
  COACH_MEMBERSHIP,
  expect,
  expectNoHorizontalOverflow,
  json,
  mockSession,
  OWNER_MEMBERSHIP,
  test,
  waitForFonts,
} from './support';

/**
 * Settings › Your account › Certificates (notes plan N4b, CLI-021) in a real browser: an owner's and a
 * coach's own certificate lines, each with its sentence and its pill, and the switch on a confirmed line
 * that shows it to their clients or hides it, worked by keyboard, held while it saves and put back when
 * the server refuses it; the page with no lines, refused and failed; in light and dark at a phone's and
 * a desk's width. Every API call is a per-test mock keyed `METHOD pathname`, and the lines are kept by a
 * small record that answers the switch as the server does (a stale version first, then a line that
 * takes no switch), so the page draws what the server answered. Guards, interceptors and stores run
 * unchanged; mockSession answers the owner's billing access, so no Founding coach row is listed.
 */
type Handler = (route: Route) => Promise<void> | void;
type LineState = 'Waiting' | 'Confirmed' | 'TakenDown';
type Role = 'Owner' | 'Coach';

/** One of the coach's own lines, as `GET /api/coach-certificates/me` answers it. */
interface OwnLine {
  id: string;
  state: LineState;
  text: string;
  what: string;
  shownOn: string;
  wordingVersion: number;
  confirmedOn: string | null;
  takenDownOn: string | null;
  coachShows: boolean;
  version: number;
}

/** What one switch sent, and the workspace it named. */
interface Write {
  lineId: string;
  body: unknown;
  tenantId: string | undefined;
}

const NEVER = /\b(verified|certified|licensed|qualified|approved)\b/i;
const LEDE =
  'What TB Gym shows your clients about you. Switch a line off and your clients stop seeing it at once. TB Gym keeps only these words, never a copy of a document.';
const EMPTY =
  'No lines yet. Send TB Gym your certificates, the gym you own or the years you’ve coached, and each confirmed one appears here.';
const REFUSED = 'Couldn’t save your choice. Try again.';
const SHOW = 'Show to my clients';
/** A panel's surface in dark mode (`--tb-surface`, #161e1b): `data-mode` stays "system". */
const DARK_SURFACE = 'rgb(22, 30, 27)';

const OWNER_LINKS = [
  'Name and region',
  'Brand',
  'Nutrition',
  'Billing',
  'Undelivered notices',
  'Notifications',
  'Appearance',
  'Password and security',
  'Certificates',
];
const COACH_LINKS = [
  'Notifications',
  'Appearance',
  'Password and security',
  'Certificates',
  'Team',
];

const IDS = {
  takenDown: '30000000-0000-4000-8000-000000000001',
  shown: '30000000-0000-4000-8000-000000000002',
  hidden: '30000000-0000-4000-8000-000000000003',
  waiting: '30000000-0000-4000-8000-000000000004',
} as const;

/**
 * Four lines in the order TB Gym recorded them, oldest first: one taken down in August, one confirmed
 * and shown, one confirmed that the coach hides, and one still waiting for TB Gym.
 */
function ownLines(): OwnLine[] {
  return [
    {
      id: IDS.takenDown,
      state: 'TakenDown',
      text: 'Six years coaching, shown to TB Gym on 10 Aug 2026',
      what: 'Six years coaching',
      shownOn: '2026-08-10',
      wordingVersion: 1,
      confirmedOn: '2026-08-11',
      takenDownOn: '2026-08-20',
      coachShows: true,
      version: 3,
    },
    {
      id: IDS.shown,
      state: 'Confirmed',
      text: 'NASM CPT, 2019, shown to TB Gym on 1 Oct 2026',
      what: 'NASM CPT, 2019',
      shownOn: '2026-10-01',
      wordingVersion: 1,
      confirmedOn: '2026-10-02',
      takenDownOn: null,
      coachShows: true,
      version: 2,
    },
    {
      id: IDS.hidden,
      state: 'Confirmed',
      text: 'BSc Sport Science, AUB, shown to TB Gym on 3 Oct 2026',
      what: 'BSc Sport Science, AUB',
      shownOn: '2026-10-03',
      wordingVersion: 1,
      confirmedOn: '2026-10-04',
      takenDownOn: null,
      coachShows: false,
      version: 4,
    },
    {
      id: IDS.waiting,
      state: 'Waiting',
      text: 'Owns Iron House gym in Hamra, shown to TB Gym on 8 Oct 2026',
      what: 'Owns Iron House gym in Hamra',
      shownOn: '2026-10-08',
      wordingVersion: 1,
      confirmedOn: null,
      takenDownOn: null,
      coachShows: true,
      version: 1,
    },
  ];
}

const SENTENCES = ownLines().map((line) => line.text);
const sentenceOf = (id: string) => ownLines().find((line) => line.id === id)!.text;

/** The coach's own lines as the server keeps them, for one test. */
class OwnLines {
  /** The workspace each read of the lines named. */
  readonly reads: (string | undefined)[] = [];
  readonly writes: Write[] = [];
  /** The fresh token and the switch, in the order the page asked for them. */
  readonly order: string[] = [];
  /** Holds the switch's answer until the test lets it go. */
  hold: Promise<void> | null = null;
  private lines: OwnLine[];
  private readonly ids: string[];

  constructor(lines: OwnLine[] = ownLines()) {
    this.lines = lines;
    this.ids = lines.map((line) => line.id);
  }

  /** Changes a line behind the page's back, as TB Gym or the coach's other tab would. */
  change(id: string, change: Partial<OwnLine>): void {
    this.lines = this.lines.map((line) => (line.id === id ? { ...line, ...change } : line));
  }

  read(route: Route): Promise<void> {
    this.reads.push(route.request().headers()['x-tenant-id']);
    return json(route, 200, { lines: this.lines });
  }

  /** The switch, refused as the server refuses it: a stale version first, then a line that takes none. */
  async shown(route: Route, lineId: string): Promise<void> {
    const body = route.request().postDataJSON() as { shown?: unknown; version?: unknown };
    this.writes.push({ lineId, body, tenantId: route.request().headers()['x-tenant-id'] });
    this.order.push('save');
    if (this.hold) await this.hold;
    const line = this.lines.find((item) => item.id === lineId);
    if (!line) return json(route, 404, { title: 'Not Found', status: 404 });
    if (typeof body.shown !== 'boolean' || typeof body.version !== 'number') {
      return json(route, 400, {
        title: 'One or more validation errors occurred.',
        status: 400,
        errors: { shown: ['Choose whether your clients see this line.'] },
      });
    }
    if (body.version !== line.version) {
      return json(route, 409, {
        code: 'certificate_line_changed',
        message:
          'This line changed since the page read it. Read the lines again, then try once more.',
      });
    }
    if (line.state !== 'Confirmed') {
      return json(route, 409, {
        code: 'certificate_line_state',
        message:
          'Only a line TB Gym confirmed that is still up can be shown or hidden. Read your lines again.',
      });
    }
    // The same choice again changes nothing and answers the line as it stands.
    if (line.coachShows === body.shown) return json(route, 200, line);
    const next: OwnLine = { ...line, coachShows: body.shown, version: line.version + 1 };
    this.change(lineId, next);
    return json(route, 200, next);
  }

  handlers(): Record<string, Handler> {
    const handlers: Record<string, Handler> = {
      'GET /api/auth/csrf': (route) => {
        this.order.push('token');
        return json(route, 200, { token: 'e2e-csrf' });
      },
      'GET /api/coach-certificates/me': (route) => this.read(route),
    };
    for (const id of this.ids) {
      handlers[`PUT /api/coach-certificates/me/${id}/shown`] = (route) => this.shown(route, id);
    }
    return handlers;
  }
}

async function openCertificates(
  page: Page,
  options: {
    role?: Role;
    width?: number;
    dark?: boolean;
    record?: OwnLines;
    extra?: Record<string, Handler>;
    path?: string;
    heading?: string;
  } = {},
): Promise<OwnLines> {
  const record = options.record ?? new OwnLines();
  await page.emulateMedia({ colorScheme: options.dark ? 'dark' : 'light' });
  await page.setViewportSize({ width: options.width ?? 1440, height: 900 });
  await mockSession(page, {
    memberships: [options.role === 'Coach' ? COACH_MEMBERSHIP : OWNER_MEMBERSHIP],
    extra: { ...record.handlers(), ...(options.extra ?? {}) },
  });
  await page.goto(options.path ?? '/account/certificates');
  await expect(
    page.getByRole('heading', { name: options.heading ?? 'Certificates', level: 1 }),
  ).toBeVisible();
  await waitForFonts(page);
  return record;
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

/** Presses Tab until the control has focus, as a keyboard reaches it. */
async function tabTo(page: Page, control: Locator, most = 25) {
  for (
    let presses = 0;
    presses < most && !(await control.evaluate((el) => el === document.activeElement));
    presses++
  ) {
    await page.keyboard.press('Tab');
  }
  await expect(control).toBeFocused();
}

const heading = (page: Page) => page.getByRole('heading', { name: 'Certificates', level: 1 });
const lineOf = (page: Page, id: string) => page.locator(`li.line[data-line="${id}"]`);
const pillOf = (page: Page, id: string) => lineOf(page, id).locator('app-status-pill');
/** A line's own switch: every switch carries the same label, so it is found inside its line. */
const switchOf = (page: Page, id: string) => lineOf(page, id).getByRole('checkbox', { name: SHOW });
/** Everything the page says, as a person reads it. */
const pageText = (page: Page) => page.evaluate(() => document.body.innerText);
const tonesOf = (page: Page) =>
  page
    .locator('li.line app-status-pill')
    .evaluateAll((pills) =>
      pills.map(
        (pill) =>
          ['success', 'warning', 'danger', 'info', 'warm'].find((tone) =>
            pill.classList.contains(tone),
          ) ?? 'neutral',
      ),
    );

for (const role of ['Owner', 'Coach'] as const) {
  const who = role === 'Owner' ? 'an owner' : 'a coach';
  const membership = role === 'Owner' ? OWNER_MEMBERSHIP : COACH_MEMBERSHIP;

  for (const width of [390, 1440]) {
    for (const dark of [false, true]) {
      const mode = dark ? 'dark' : 'light';

      test(`${who} reads their lines and switches one by keyboard at ${width}px, ${mode}`, async ({
        page,
      }) => {
        const record = await openCertificates(page, { role, width, dark });

        await expect(page).toHaveTitle('Certificates | TB Gym');
        const kicker = page.locator('header.top .kicker');
        await expect(kicker).toHaveText('Your account');
        await expect(page.locator('header.top .lede')).toHaveText(LEDE);
        const kickerBox = (await kicker.boundingBox())!;
        const headingBox = (await heading(page).boundingBox())!;
        expect(kickerBox.y + kickerBox.height).toBeLessThanOrEqual(headingBox.y + 0.5);

        // The Settings list names the page, after Password and security, as the one open.
        const nav = page.getByRole('navigation', { name: 'Settings' });
        await expect(nav.getByRole('link')).toHaveText(
          role === 'Owner' ? OWNER_LINKS : COACH_LINKS,
        );
        const current = nav.getByRole('link', { name: 'Certificates' });
        await expect(current).toHaveAttribute('aria-current', 'page');
        await expect(current).toHaveAttribute('href', '/account/certificates');
        // On a phone the list is one row that scrolls sideways, the open page scrolled into view.
        await expect(current).toBeInViewport();

        // Every line in the server's order, its sentence in a <bdi>, its pill and its tone.
        expect(
          await page
            .locator('li.line')
            .evaluateAll((items) => items.map((item) => item.getAttribute('data-line'))),
        ).toEqual([IDS.takenDown, IDS.shown, IDS.hidden, IDS.waiting]);
        await expect(page.locator('li.line [data-sentence] > bdi')).toHaveText(SENTENCES);
        await expect(page.locator('li.line app-status-pill')).toHaveText([
          'Taken down 20 Aug 2026',
          'Shown to clients',
          'Hidden',
          'Waiting for TB Gym',
        ]);
        expect(await tonesOf(page)).toEqual(['neutral', 'success', 'neutral', 'warning']);

        // The switch only on a confirmed line, each told apart by its own sentence.
        await expect(page.getByRole('checkbox', { name: SHOW })).toHaveCount(2);
        await expect(lineOf(page, IDS.takenDown).getByRole('checkbox')).toHaveCount(0);
        await expect(lineOf(page, IDS.waiting).getByRole('checkbox')).toHaveCount(0);
        await expect(switchOf(page, IDS.shown)).toBeChecked();
        await expect(switchOf(page, IDS.hidden)).not.toBeChecked();
        await expect(switchOf(page, IDS.shown)).toHaveAccessibleDescription(sentenceOf(IDS.shown));
        await expect(switchOf(page, IDS.hidden)).toHaveAccessibleDescription(
          sentenceOf(IDS.hidden),
        );

        // Nothing on the page adds, edits or asks for a file.
        const host = page.locator('app-account-certificates');
        await expect(host.getByRole('button')).toHaveCount(0);
        await expect(host.getByRole('textbox')).toHaveCount(0);
        await expect(host.locator('input[type="file"]')).toHaveCount(0);

        // The page follows the person's mode: nothing forces it light.
        await expect(page.locator('main')).not.toHaveAttribute('data-mode', 'light');
        const surface = await page
          .locator('section.panel')
          .first()
          .evaluate((panel) => getComputedStyle(panel).backgroundColor);
        if (dark) expect(surface).toBe(DARK_SURFACE);
        else expect(surface).not.toBe(DARK_SURFACE);
        expect(await pageText(page)).not.toMatch(NEVER);
        await expectNoHorizontalOverflow(page);
        await axe(page);
        await page.screenshot({
          path: `test-results/n4b-certificates-${role.toLowerCase()}-${width}-${mode}.png`,
          fullPage: true,
        });

        // By keyboard: Tab to the shown line's switch; Space hides it, Space shows it again, each
        // against the version the last answer carried, and the pill follows each answer.
        const shown = switchOf(page, IDS.shown);
        await heading(page).focus();
        await tabTo(page, shown);
        await page.keyboard.press('Space');
        await expect(pillOf(page, IDS.shown)).toHaveText('Hidden');
        await expect(lineOf(page, IDS.shown).getByRole('status')).toHaveCount(0);
        await expect(shown).not.toBeChecked();
        await expect(shown).toBeFocused();
        expect(record.writes).toEqual([
          { lineId: IDS.shown, body: { shown: false, version: 2 }, tenantId: membership.tenantId },
        ]);
        await page.screenshot({
          path: `test-results/n4b-certificates-${role.toLowerCase()}-hidden-${width}-${mode}.png`,
          fullPage: true,
        });

        await page.keyboard.press('Space');
        await expect(pillOf(page, IDS.shown)).toHaveText('Shown to clients');
        await expect(lineOf(page, IDS.shown).getByRole('status')).toHaveCount(0);
        await expect(shown).toBeChecked();
        await expect(shown).toBeFocused();
        expect(record.writes.map((write) => write.body)).toEqual([
          { shown: false, version: 2 },
          { shown: true, version: 3 },
        ]);
        // Every read and write named the open workspace.
        expect(new Set([...record.reads, ...record.writes.map((write) => write.tenantId)])).toEqual(
          new Set([membership.tenantId]),
        );
        // Only that switch changed; the other lines are as the server read them.
        await expect(page.locator('li.line app-status-pill')).toHaveText([
          'Taken down 20 Aug 2026',
          'Shown to clients',
          'Hidden',
          'Waiting for TB Gym',
        ]);
        await axe(page);
      });
    }
  }
}

test('the switch keeps focus while it saves, puts a second press back, and saves after a fresh token', async ({
  page,
}) => {
  const record = new OwnLines();
  let release!: () => void;
  record.hold = new Promise<void>((resolve) => (release = resolve));
  await openCertificates(page, { record });
  const shown = switchOf(page, IDS.shown);
  const line = lineOf(page, IDS.shown);
  await heading(page).focus();
  await tabTo(page, shown);
  record.order.length = 0;

  await page.keyboard.press('Space');
  await expect(line.getByRole('status')).toHaveText('Saving your choice…');
  await expect(shown).not.toBeChecked();
  await expect(shown).toBeFocused();
  // Until the server answers, the pill says what the server holds.
  await expect(pillOf(page, IDS.shown)).toHaveText('Shown to clients');
  // The box is never disabled; a press meanwhile goes back to the choice on its way.
  await page.keyboard.press('Space');
  await expect(shown).not.toBeChecked();
  await expect(shown).toBeFocused();
  await expectNoHorizontalOverflow(page);
  await axe(page);
  await page.screenshot({ path: 'test-results/n4b-certificates-saving-1440.png', fullPage: true });

  release();
  await expect(pillOf(page, IDS.shown)).toHaveText('Hidden');
  await expect(line.getByRole('status')).toHaveCount(0);
  await expect(shown).not.toBeChecked();
  await expect(shown).toBeFocused();
  expect(record.writes.map((write) => write.body)).toEqual([{ shown: false, version: 2 }]);
  expect(record.order).toEqual(['token', 'save']);
});

test.describe('when the server refuses the switch', () => {
  test.use({
    allowedConsoleErrors: { patterns: [/status of 409 .*\/api\/coach-certificates\/me\//] },
  });

  for (const width of [390, 1440]) {
    test(`a line changed meanwhile puts the box back, says so under the line and reads the lines again at ${width}px`, async ({
      page,
    }) => {
      const record = await openCertificates(page, { width });
      // The line changed since the page read it (the coach's other tab, say).
      record.change(IDS.shown, { version: 5 });
      const reads = record.reads.length;
      const shown = switchOf(page, IDS.shown);
      const line = lineOf(page, IDS.shown);

      await shown.click();

      const refusal = line.getByRole('alert');
      await expect(refusal).toHaveText(REFUSED);
      await expect(refusal).toHaveAttribute('id', `certificate-${IDS.shown}-error`);
      await expect(shown).toBeChecked();
      await expect(pillOf(page, IDS.shown)).toHaveText('Shown to clients');
      await expect(shown).toHaveAccessibleDescription(
        /^NASM CPT, 2019, shown to TB Gym on 1 Oct 2026\s+Couldn’t save your choice\. Try again\.$/,
      );
      await expect.poll(() => record.reads.length).toBe(reads + 1);
      expect(record.writes.map((write) => write.body)).toEqual([{ shown: false, version: 2 }]);
      // Under the line's own switch, and only there.
      const box = (await shown.boundingBox())!;
      const said = (await refusal.boundingBox())!;
      expect(said.y).toBeGreaterThanOrEqual(box.y + box.height - 0.5);
      // As tall as its words: the shared refusal's flex basis must not turn into a height in the line's column.
      const [paragraph, words] = await refusal.evaluate((sentence) => {
        const range = document.createRange();
        range.selectNodeContents(sentence);
        return [sentence.getBoundingClientRect().height, range.getBoundingClientRect().height];
      });
      expect(paragraph, 'the refusal is as tall as its words').toBeLessThan(words + 16);
      await expect(page.getByRole('alert')).toHaveCount(1);
      await expectNoHorizontalOverflow(page);
      await axe(page);
      await page.screenshot({
        path: `test-results/n4b-certificates-refused-${width}.png`,
        fullPage: true,
      });

      // The lines read again carry the newer version: the next press saves, and the refusal goes.
      await shown.click();
      await expect(pillOf(page, IDS.shown)).toHaveText('Hidden');
      await expect(refusal).toHaveCount(0);
      await expect(shown).not.toBeChecked();
      await expect(shown).toHaveAccessibleDescription(sentenceOf(IDS.shown));
      expect(record.writes.map((write) => write.body)).toEqual([
        { shown: false, version: 2 },
        { shown: false, version: 5 },
      ]);
    });
  }

  test('a line TB Gym took down meanwhile loses its switch, says so by its pill, and the heading takes focus', async ({
    page,
  }) => {
    const record = await openCertificates(page, { width: 390, dark: true });
    record.change(IDS.shown, { state: 'TakenDown', takenDownOn: '2026-10-09', version: 3 });
    const shown = switchOf(page, IDS.shown);
    const line = lineOf(page, IDS.shown);
    await shown.focus();

    await page.keyboard.press('Space');

    await expect(pillOf(page, IDS.shown)).toHaveText('Taken down 9 Oct 2026');
    await expect(line.getByRole('checkbox')).toHaveCount(0);
    // Nothing is left to try again: the refusal goes with the switch, as the Founding coach page's does.
    await expect(line.getByRole('alert')).toHaveCount(0);
    await expect(heading(page)).toBeFocused();
    // The other confirmed line keeps its switch.
    await expect(switchOf(page, IDS.hidden)).not.toBeChecked();
    expect(record.writes.map((write) => write.body)).toEqual([{ shown: false, version: 2 }]);
    await expectNoHorizontalOverflow(page);
    await axe(page);
    await page.screenshot({
      path: 'test-results/n4b-certificates-taken-down-390-dark.png',
      fullPage: true,
    });
  });
});

for (const [width, dark] of [
  [390, true],
  [1440, false],
] as const) {
  const mode = dark ? 'dark' : 'light';

  test(`with no lines yet the page says how a line comes at ${width}px, ${mode}`, async ({
    page,
  }) => {
    await openCertificates(page, { width, dark, record: new OwnLines([]) });

    const empty = page.locator('[data-certificates-empty]');
    await expect(empty).toHaveText(EMPTY);
    // The panel holds the sentence and no blank under it: the paragraph is as tall as its text.
    const [paragraph, text] = await empty.locator('p').evaluate((sentence) => {
      const words = document.createRange();
      words.selectNodeContents(sentence);
      return [sentence.getBoundingClientRect().height, words.getBoundingClientRect().height];
    });
    expect.soft(paragraph, 'the empty sentence is as tall as its text').toBeLessThan(text + 16);
    await expect(page.locator('li.line')).toHaveCount(0);
    await expect(page.getByRole('checkbox')).toHaveCount(0);
    await expect(
      page
        .getByRole('navigation', { name: 'Settings' })
        .getByRole('link', { name: 'Certificates' }),
    ).toHaveAttribute('aria-current', 'page');
    expect(await pageText(page)).not.toMatch(NEVER);
    await expectNoHorizontalOverflow(page);
    await axe(page);
    await page.screenshot({
      path: `test-results/n4b-certificates-empty-${width}-${mode}.png`,
      fullPage: true,
    });
  });
}

test.describe('when the lines cannot be read', () => {
  test.use({
    allowedConsoleErrors: { patterns: [/status of (403|500) .*\/api\/coach-certificates\/me/] },
  });

  for (const [role, width, back] of [
    ['Owner', 390, '/workspace'],
    ['Coach', 1440, '/notifications/settings'],
  ] as const) {
    test(`a refusal tells ${role === 'Owner' ? 'an owner' : 'a coach'} nothing is here, with the way back to Settings, at ${width}px`, async ({
      page,
    }) => {
      await openCertificates(page, {
        role,
        width,
        extra: {
          'GET /api/coach-certificates/me': (route) =>
            json(route, 403, { title: 'Forbidden', status: 403 }),
        },
      });

      const nothing = page.locator('[data-certificates-nothing]');
      await expect(nothing.getByRole('heading', { name: 'Nothing here', level: 2 })).toBeVisible();
      await expect(nothing).toContainText(
        'This page is for the owner and the coaches of a coaching space.',
      );
      await expect(nothing.getByRole('link', { name: 'Back to Settings' })).toHaveAttribute(
        'href',
        back,
      );
      await expect(page.getByRole('checkbox')).toHaveCount(0);
      await expectNoHorizontalOverflow(page);
      await axe(page);
      await page.screenshot({
        path: `test-results/n4b-certificates-nothing-${role.toLowerCase()}-${width}.png`,
        fullPage: true,
      });
    });
  }

  test('a failed read offers Try again, which reads the lines', async ({ page }) => {
    let fail = true;
    const record = new OwnLines();
    await openCertificates(page, {
      width: 390,
      record,
      extra: {
        'GET /api/coach-certificates/me': (route) =>
          fail ? json(route, 500, { title: 'Failed', status: 500 }) : record.read(route),
      },
    });

    await expect(page.getByRole('alert')).toHaveText('Your certificate lines couldn’t be loaded.');
    await expect(page.locator('li.line')).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
    await axe(page);
    await page.screenshot({ path: 'test-results/n4b-certificates-failed-390.png', fullPage: true });

    fail = false;
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.locator('li.line')).toHaveCount(4);
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(switchOf(page, IDS.shown)).toBeChecked();
  });
});

for (const width of [390, 1440]) {
  test(`the lines reflow with 200% text at ${width}px`, async ({ page }) => {
    await openCertificates(page, { width });
    await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });

    await expect(switchOf(page, IDS.shown)).toBeVisible();
    await expectNoHorizontalOverflow(page);
    for (const id of Object.values(IDS)) {
      const line = lineOf(page, id);
      const outer = (await line.boundingBox())!;
      for (const part of [line.locator('[data-sentence]'), line.locator('app-status-pill')]) {
        const inner = (await part.boundingBox())!;
        expect(inner.x).toBeGreaterThanOrEqual(outer.x - 0.5);
        expect(inner.x + inner.width).toBeLessThanOrEqual(outer.x + outer.width + 0.5);
      }
    }
    const label = lineOf(page, IDS.shown).locator('app-checkbox');
    const labelBox = (await label.boundingBox())!;
    const lineBox = (await lineOf(page, IDS.shown).boundingBox())!;
    expect(labelBox.x + labelBox.width).toBeLessThanOrEqual(lineBox.x + lineBox.width + 0.5);
    await page.screenshot({
      path: `test-results/n4b-certificates-200-${width}.png`,
      fullPage: true,
    });
  });
}

test('a coach opens Certificates from their Settings, and the sidebar keeps Settings selected', async ({
  page,
}) => {
  const record = await openCertificates(page, {
    role: 'Coach',
    path: '/account/appearance',
    heading: 'Appearance',
  });
  const nav = page.getByRole('navigation', { name: 'Settings' });

  await nav.getByRole('link', { name: 'Certificates' }).click();

  await expect(page).toHaveURL(/\/account\/certificates$/);
  await expect(heading(page)).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Certificates' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(page.locator('.sidebar a.item[data-destination="settings"]')).toHaveAttribute(
    'aria-current',
    'true',
  );
  await expect(page.locator('li.line')).toHaveCount(4);
  expect(record.reads).toEqual([COACH_MEMBERSHIP.tenantId]);
});
