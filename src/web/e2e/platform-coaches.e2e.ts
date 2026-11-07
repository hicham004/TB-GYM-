import AxeBuilder from '@axe-core/playwright';
import type { Locator, Page, Route } from '@playwright/test';
import {
  CERTIFICATE_WORD_REFUSAL,
  certificateCoaches,
  certificateLine,
  certificateLines,
  COACH_IDS,
  confirmedLine,
  erasedLine,
  foundingTerms,
  gymRequests,
  NOW,
  platformSpaces,
  pricePlans,
  SPACE_IDS,
  TODAY,
} from '../src/testing/platform-admin-fixtures';
import type {
  CertificateCoach,
  CertificateLine,
  CertificateLines,
} from '../src/app/features/platform-admin/platform-coaches.models';
import { chooseDay, kitDateField } from './kit-controls';
import {
  expect,
  expectNoHorizontalOverflow,
  json,
  mockSession,
  SIGNED_IN_USER,
  test,
  useRtl,
  waitForFonts,
} from './support';

/**
 * The platform admin's Coaches page (notes plan N4a, CLI-021) in a real browser: the list, a coach's
 * sheet with their lines, the three write sheets that open on top of it and the two questions, in
 * light and dark at a phone's and a desk's width. Every API call is a per-test mock keyed
 * `METHOD pathname`, answered in place by a small record that keeps lines as the server does, so a
 * write shows on the next read; guards, interceptors and stores run unchanged. The space's today is
 * the mock's, so the far-zone project proves no date field reads the device's day.
 */
const ADMIN = { ...SIGNED_IN_USER, displayName: 'Hicham Haddad', roles: ['PlatformAdmin'] };

const NEVER = /\b(verified|certified|licensed|qualified|approved)\b/i;
/** The words the server keeps out of a line (CoachCertificateLine's refused words). */
const REFUSED =
  /\b(?:verified|licensed|qualified|approved|physiotherapists?|physical[\s\p{Pd}]+therapists?|physios?)\b/iu;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

interface Writes {
  add: unknown[];
  confirm: unknown[];
  drop: unknown[];
  takeDown: unknown[];
  erase: unknown[];
}

const key = (userId: string, tenantId: string) => `${userId}/${tenantId}`;

/** The day as the server's sentence writes it in English, "5 Oct 2026". */
function sentenceDay(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number);
  return `${day} ${MONTHS[month - 1]} ${year}`;
}

/** The certificate record as the server keeps it, for one test. */
class CertificateRecord {
  readonly writes: Writes = { add: [], confirm: [], drop: [], takeDown: [], erase: [] };
  private readonly lines = new Map<string, CertificateLine[]>();
  private added = 0;

  constructor() {
    this.lines.set(key(COACH_IDS.karim, SPACE_IDS.atlas), [...certificateLines().lines]);
    this.lines.set(key(COACH_IDS.nadine, SPACE_IDS.atlas), [
      confirmedLine({
        id: 'line-degree',
        text: 'BSc Sport Science, AUB, shown to TB Gym on 1 Oct 2026',
        what: 'BSc Sport Science, AUB',
      }),
    ]);
    this.lines.set(key(COACH_IDS.omar, SPACE_IDS.atlas), [
      certificateLine({
        id: 'line-issa',
        text: 'ISSA Strength and Conditioning, 2020, shown to TB Gym on 6 Oct 2026',
        what: 'ISSA Strength and Conditioning, 2020',
        shownOn: '2026-10-06',
        recordedAtUtc: '2026-10-06T09:00:00Z',
        recordedOn: '2026-10-06',
      }),
    ]);
    this.lines.set(key(COACH_IDS.sami, SPACE_IDS.arz), [
      erasedLine({ id: 'line-arz-2' }),
      erasedLine({ id: 'line-arz-1', recordedAtUtc: '2026-06-01T10:00:00Z' }),
    ]);
  }

  coaches(): CertificateCoach[] {
    return certificateCoaches().map((coach) => {
      const lines = this.lines.get(key(coach.userId, coach.tenantId)) ?? [];
      const count = (state: CertificateLine['state']) =>
        lines.filter((line) => line.state === state).length;
      return {
        ...coach,
        waitingLines: count('Waiting'),
        confirmedLines: count('Confirmed'),
        takenDownLines: count('TakenDown'),
        erasedLines: count('Erased'),
      };
    });
  }

  view(userId: string, tenantId: string): CertificateLines | null {
    const coach = certificateCoaches().find(
      (item) => item.userId === userId && item.tenantId === tenantId,
    );
    if (!coach) return null;
    return {
      userId,
      name: coach.name,
      email: coach.email,
      tenantId,
      spaceName: coach.spaceName,
      role: coach.role,
      isActiveStaff: coach.isActiveStaff,
      spaceToday: TODAY,
      lines: this.lines.get(key(userId, tenantId)) ?? [],
    };
  }

  /** Answers every `/api/platform-admin/coaches` route, as the server would. */
  async answer(route: Route): Promise<void> {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const routeKey = `${request.method()} ${path}`;
    if (routeKey === 'GET /api/platform-admin/coaches') return json(route, 200, this.coaches());

    const space = /^\w+ \/api\/platform-admin\/coaches\/([^/]+)\/spaces\/([^/]+)\/(.+)$/.exec(
      routeKey,
    );
    const view = space ? this.view(space[1], space[2]) : null;
    if (!space || !view) return json(route, 404, { title: 'Not Found', status: 404 });
    const [, userId, tenantId, rest] = space;
    const lines = this.lines.get(key(userId, tenantId)) ?? [];
    const save = (next: CertificateLine[]) => this.lines.set(key(userId, tenantId), next);

    if (rest === 'lines' && request.method() === 'GET') return json(route, 200, view);
    if (rest === 'lines' && request.method() === 'POST') {
      const body = request.postDataJSON() as { what: string; shownOn: string };
      this.writes.add.push(body);
      if (!view.isActiveStaff) return json(route, 404, { title: 'Not Found', status: 404 });
      if (REFUSED.test(body.what)) {
        return json(route, 400, {
          title: 'One or more validation errors occurred.',
          status: 400,
          errors: { what: [CERTIFICATE_WORD_REFUSAL] },
        });
      }
      const what = body.what.trim();
      const same = lines.find(
        (line) => line.state !== 'Erased' && line.what === what && line.shownOn === body.shownOn,
      );
      if (same) return json(route, 200, same);
      const line = certificateLine({
        id: `line-new-${++this.added}`,
        text: `${what}, shown to TB Gym on ${sentenceDay(body.shownOn)}`,
        what,
        shownOn: body.shownOn,
        recordedAtUtc: NOW,
        recordedOn: TODAY,
      });
      save([line, ...lines]);
      return json(route, 201, line);
    }

    if (rest === 'erase' && request.method() === 'POST') {
      const body = request.postDataJSON() as { requestedOn: string };
      this.writes.erase.push(body);
      const dropped = lines.filter((line) => line.state === 'Waiting').length;
      const erased = lines.filter(
        (line) => line.state === 'Confirmed' || line.state === 'TakenDown',
      ).length;
      save(
        lines
          .filter((line) => line.state !== 'Waiting')
          .map((line) =>
            line.state === 'Erased'
              ? line
              : {
                  ...line,
                  state: 'Erased',
                  text: null,
                  what: null,
                  shownOn: null,
                  confirmedByName: null,
                  erasedAtUtc: NOW,
                  erasedOn: TODAY,
                  erasureReason: 'Request',
                  requestedOn: body.requestedOn,
                  erasedByName: ADMIN.displayName,
                  version: line.version + 1,
                },
          ),
      );
      return json(route, 200, { erased, dropped });
    }

    const change = /^lines\/([^/]+)\/(confirm|drop|take-down)$/.exec(rest);
    const line = change ? lines.find((item) => item.id === change[1]) : undefined;
    if (!change || !line || request.method() !== 'POST') {
      return json(route, 404, { title: 'Not Found', status: 404 });
    }
    const body = request.postDataJSON() as { version: number; confirmedByName?: string };
    const refuse = (code: string, message: string) => json(route, 409, { code, message });
    const update = (next: CertificateLine) =>
      save(lines.map((item) => (item.id === next.id ? next : item)));
    if (body.version !== line.version) {
      return refuse(
        'certificate_line_changed',
        'This line changed since the page read it. Read the lines again, then try once more.',
      );
    }
    switch (change[2]) {
      case 'confirm': {
        this.writes.confirm.push(body);
        if (line.state !== 'Waiting') {
          return refuse(
            'certificate_line_state',
            'This line is no longer waiting for confirmation. Read the lines again.',
          );
        }
        const next: CertificateLine = {
          ...line,
          state: 'Confirmed',
          confirmedAtUtc: NOW,
          confirmedOn: TODAY,
          confirmedByName: body.confirmedByName?.trim() ?? null,
          version: line.version + 1,
        };
        update(next);
        return json(route, 200, next);
      }
      case 'drop':
        this.writes.drop.push(body);
        if (line.state !== 'Waiting') {
          return refuse(
            'certificate_line_state',
            'Only a line still waiting for confirmation can be dropped. Take a confirmed line down instead.',
          );
        }
        save(lines.filter((item) => item.id !== line.id));
        return json(route, 200, { lineId: line.id });
      default: {
        this.writes.takeDown.push(body);
        if (line.state !== 'Confirmed') {
          return refuse(
            'certificate_line_state',
            'Only a confirmed line that is still up can be taken down.',
          );
        }
        const next: CertificateLine = {
          ...line,
          state: 'TakenDown',
          takenDownAtUtc: NOW,
          takenDownOn: TODAY,
          takenDownByName: ADMIN.displayName,
          version: line.version + 1,
        };
        update(next);
        return json(route, 200, next);
      }
    }
  }
}

async function openCoaches(page: Page, width: number, dark = false, path = '/admin/coaches') {
  await page.clock.setFixedTime(new Date(NOW));
  await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light' });
  await page.setViewportSize({ width, height: 900 });
  const record = new CertificateRecord();
  await mockSession(page, {
    user: ADMIN,
    extra: {
      'GET /api/auth/csrf': (route) => json(route, 200, { token: 'e2e-csrf' }),
      // Platform billing, for the page it links from and back to.
      'GET /api/platform-admin/workspaces': (route) => json(route, 200, platformSpaces()),
      'GET /api/platform-admin/price-plans': (route) => json(route, 200, pricePlans()),
      'GET /api/platform-admin/contact-requests': (route) => json(route, 200, gymRequests()),
      'GET /api/platform-admin/founding-terms': (route) => json(route, 200, [foundingTerms()]),
    },
  });
  // Registered after the session's mocks, so it is asked first; its paths carry line ids it makes.
  await page.route(
    (url) => url.pathname.startsWith('/api/platform-admin/coaches'),
    (route) => record.answer(route),
  );
  await page.goto(path);
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

const heading = (page: Page) => page.getByRole('heading', { name: 'Coaches', level: 1 });
const rowOf = (page: Page, userId: string, tenantId: string = SPACE_IDS.atlas) =>
  page.locator(`li.coach[data-coach="${userId}"][data-space="${tenantId}"]`);
const sheetOf = (page: Page, name: string) => page.getByRole('dialog', { name, exact: true });
const lineOf = (sheet: Locator, id: string) => sheet.locator(`[data-line="${id}"]`);

/** Everything the page and its overlays say, as a person reads it. */
const pageText = (page: Page) => page.evaluate(() => document.body.innerText);

for (const width of [390, 1440]) {
  for (const dark of [false, true]) {
    const mode = dark ? '-dark' : '';
    const named = `${width}px${dark ? ' in dark mode' : ''}`;

    test(`the list, a coach’s sheet, adding a line and marking it confirmed at ${named}`, async ({
      page,
    }) => {
      const record = await openCoaches(page, width, dark);
      await expect(heading(page)).toBeFocused();
      await expect(page.locator('li.coach .name')).toHaveText([
        'Karim Haddad',
        'Lea Khoury',
        'Nadine Saliba',
        'Omar Nassar',
        'Omar Nassar',
        'سامي الخوري',
      ]);
      await expect(page.locator('li.coach .role')).toHaveText([
        'Owner · Atlas Performance',
        'Coach · Atlas Performance',
        'Former coach · Atlas Performance',
        'Coach · Atlas Performance',
        'Coach · Beirut Barbell',
        'Owner · نادي الأرز',
      ]);
      await expect(page.locator('li.coach .count')).toHaveText([
        '3 lines · 1 waiting · 1 taken down · 1 erased',
        'No lines yet',
        '1 line',
        '1 line · 1 waiting',
        'No lines yet',
        'No lines · 2 erased',
      ]);
      await expect(page.getByRole('status')).toHaveText('6 coaches');
      expect(await pageText(page)).not.toMatch(NEVER);
      await expectNoHorizontalOverflow(page);
      await axe(page);
      await page.screenshot({ path: `test-results/n4a-list-${width}${mode}.png`, fullPage: true });

      await rowOf(page, COACH_IDS.karim).getByRole('button', { name: 'Karim Haddad' }).click();
      const sheet = sheetOf(page, 'Karim Haddad');
      await expect(sheet.locator('li.line')).toHaveCount(4);
      await expect(sheet.locator('li.line app-status-pill')).toHaveText([
        'Waiting for confirmation',
        'Confirmed 2 Oct 2026',
        'Taken down 20 Aug 2026',
        'Erased 2 Jul 2026',
      ]);
      await expect(sheet.locator('.about')).toContainText('Owner · Atlas Performance');
      await expect(
        lineOf(sheet, 'line-gym').getByRole('button', {
          name: 'Mark confirmed Owns Iron House gym in Hamra, shown to TB Gym on 8 Oct 2026',
        }),
      ).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await axe(page);
      await page.screenshot({ path: `test-results/n4a-sheet-${width}${mode}.png` });

      await sheet.getByRole('button', { name: 'Add a line' }).click();
      const add = sheetOf(page, 'Add a line');
      await expect(page.getByRole('dialog')).toHaveCount(2);
      await expect(add.locator('.about')).toHaveText('Karim Haddad · Atlas Performance');
      await expect(add.getByRole('button', { name: /Shown on/ })).toContainText('Oct 9, 2026');
      await add.getByLabel('What they showed').fill('BSc Sport Science, AUB');
      await chooseDay(add, 'Shown on', '2026-10-05');
      await expect(add.getByRole('button', { name: /Shown on/ })).toContainText('Oct 5, 2026');
      await expectNoHorizontalOverflow(page);
      await axe(page);
      await page.screenshot({ path: `test-results/n4a-add-${width}${mode}.png` });
      await add.getByRole('button', { name: 'Add', exact: true }).click();

      await expect(page.getByRole('dialog')).toHaveCount(1);
      expect(record.writes.add).toEqual([
        { what: 'BSc Sport Science, AUB', shownOn: '2026-10-05' },
      ]);
      await expect(page.getByText('Line added.')).toBeVisible();
      const added = lineOf(sheet, 'line-new-1');
      await expect(sheet.locator('li.line').first()).toHaveAttribute('data-line', 'line-new-1');
      await expect(added.locator('[data-sentence]')).toHaveText(
        'BSc Sport Science, AUB, shown to TB Gym on 5 Oct 2026',
      );
      await expect(added.locator('app-status-pill')).toHaveText('Waiting for confirmation');

      await added.getByRole('button', { name: /^Mark confirmed/ }).click();
      const confirm = sheetOf(page, 'Mark confirmed');
      await expect(page.getByRole('dialog')).toHaveCount(2);
      await expect(confirm.locator('.about')).toHaveText(
        'BSc Sport Science, AUB, shown to TB Gym on 5 Oct 2026',
      );
      await expect(confirm.getByLabel('Who confirmed it with the coach?')).toHaveValue(
        'Hicham Haddad',
      );
      await expectNoHorizontalOverflow(page);
      await axe(page);
      await page.screenshot({ path: `test-results/n4a-confirm-${width}${mode}.png` });
      await confirm.getByRole('button', { name: 'Confirm', exact: true }).click();

      await expect(page.getByRole('dialog')).toHaveCount(1);
      expect(record.writes.confirm).toEqual([{ confirmedByName: 'Hicham Haddad', version: 1 }]);
      await expect(page.getByText('Line confirmed.')).toBeVisible();
      await expect(added.locator('app-status-pill')).toHaveText('Confirmed 9 Oct 2026');
      await expect(added.locator('[data-by]')).toHaveText(
        'Confirmed and recorded by Hicham Haddad',
      );
      await expect(added.getByRole('button', { name: /^Take down/ })).toBeVisible();

      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(rowOf(page, COACH_IDS.karim).locator('.count')).toHaveText(
        '4 lines · 1 waiting · 1 taken down · 1 erased',
      );
    });

    test(`dropping, taking down and erasing on request at ${named}`, async ({ page }) => {
      const record = await openCoaches(page, width, dark);
      await rowOf(page, COACH_IDS.karim).getByRole('button', { name: 'Karim Haddad' }).click();
      const sheet = sheetOf(page, 'Karim Haddad');
      await expect(sheet.locator('li.line')).toHaveCount(4);

      await lineOf(sheet, 'line-gym').getByRole('button', { name: /^Drop/ }).click();
      const drop = sheetOf(page, 'Drop this line?');
      await expect(drop).toContainText('Nothing about it is kept.');
      await expectNoHorizontalOverflow(page);
      await axe(page);
      await page.screenshot({ path: `test-results/n4a-drop-${width}${mode}.png` });
      await drop.getByRole('button', { name: 'Drop', exact: true }).click();
      await expect(page.getByText('Line dropped.')).toBeVisible();
      await expect(lineOf(sheet, 'line-gym')).toHaveCount(0);
      expect(record.writes.drop).toEqual([{ version: 1 }]);

      await lineOf(sheet, 'line-nasm')
        .getByRole('button', { name: /^Take down/ })
        .click();
      const takeDown = sheetOf(page, 'Take this line down?');
      await expect(takeDown).toContainText(
        'The coach’s clients stop seeing it at once. TB Gym keeps the words for the keeping period, then erases them.',
      );
      await expectNoHorizontalOverflow(page);
      await axe(page);
      await page.screenshot({ path: `test-results/n4a-take-down-${width}${mode}.png` });
      await takeDown.getByRole('button', { name: 'Take down', exact: true }).click();
      await expect(page.getByText('Line taken down.')).toBeVisible();
      await expect(lineOf(sheet, 'line-nasm').locator('app-status-pill')).toHaveText(
        'Taken down 9 Oct 2026',
      );
      expect(record.writes.takeDown).toEqual([{ version: 2 }]);

      await sheet.getByRole('button', { name: 'Erase on request' }).click();
      const erase = sheetOf(page, 'Erase on request');
      await expect(erase.locator('[data-deadline]')).toHaveText(
        'Requests are met within 10 days: by 19 Oct 2026.',
      );
      await chooseDay(erase, 'The day the coach asked', '2026-10-06');
      await expect(erase.locator('[data-deadline]')).toHaveText(
        'Requests are met within 10 days: by 16 Oct 2026.',
      );
      await expectNoHorizontalOverflow(page);
      await axe(page);
      await page.screenshot({ path: `test-results/n4a-erase-${width}${mode}.png` });
      await erase.getByRole('button', { name: 'Erase', exact: true }).click();
      const ask = sheetOf(page, 'Erase every line of this coach in this space?');
      await expect(ask).toContainText('The words are gone for good; the dates and who acted stay.');
      await expect(page.getByRole('dialog')).toHaveCount(3);
      await axe(page);
      await page.screenshot({ path: `test-results/n4a-erase-ask-${width}${mode}.png` });
      await ask.getByRole('button', { name: 'Erase', exact: true }).click();

      await expect(page.getByRole('dialog')).toHaveCount(1);
      await expect(page.getByText('Erased 2 lines.')).toBeVisible();
      expect(record.writes.erase).toEqual([{ requestedOn: '2026-10-06' }]);
      await expect(sheet.locator('li.line [data-erased]')).toHaveText([
        'Erased at the coach’s request',
        'Erased at the coach’s request',
        'Erased at the coach’s request',
      ]);
      await expect(sheet.getByRole('button', { name: 'Erase on request' })).toHaveCount(0);
      await expect(sheet.locator('[data-sentence]')).toHaveCount(0);
      expect(await pageText(page)).not.toMatch(NEVER);
      await expectNoHorizontalOverflow(page);
      await axe(page);
      await page.screenshot({ path: `test-results/n4a-erased-${width}${mode}.png` });
    });
  }
}

test.describe('a line the server refuses', () => {
  test.use({ allowedConsoleErrors: { patterns: [/status of 400/] } });

  for (const width of [390, 1440]) {
    test(`says the server’s sentence under the field, keeping what was typed, at ${width}px`, async ({
      page,
    }) => {
      const record = await openCoaches(page, width);
      await rowOf(page, COACH_IDS.karim).getByRole('button', { name: 'Karim Haddad' }).click();
      await sheetOf(page, 'Karim Haddad').getByRole('button', { name: 'Add a line' }).click();
      const add = sheetOf(page, 'Add a line');

      await add.getByLabel('What they showed').fill('Licensed trainer since 2019');
      await add.getByRole('button', { name: 'Add', exact: true }).click();

      const field = add.locator('app-field', { hasText: 'What they showed' });
      await expect(field.locator('.tb-field__support--error')).toHaveText(CERTIFICATE_WORD_REFUSAL);
      await expect(add.getByLabel('What they showed')).toBeFocused();
      await expect(add.getByLabel('What they showed')).toHaveValue('Licensed trainer since 2019');
      await expect(add.getByLabel('What they showed')).toHaveAttribute('aria-invalid', 'true');
      await expect(page.getByRole('dialog')).toHaveCount(2);
      expect(record.writes.add).toEqual([{ what: 'Licensed trainer since 2019', shownOn: TODAY }]);
      // The page says none of the five words, the refusal included; what was typed is in the box.
      expect(await pageText(page)).not.toMatch(NEVER);
      await expectNoHorizontalOverflow(page);
      await axe(page);
      await page.screenshot({ path: `test-results/n4a-add-refused-${width}.png` });

      await add.getByLabel('What they showed').fill('BSc Physiotherapy, AUB');
      await expect(field.locator('.tb-field__support--error')).toHaveCount(0);
      await add.getByRole('button', { name: 'Add', exact: true }).click();
      await expect(page.getByRole('dialog')).toHaveCount(1);
      await expect(page.getByText('Line added.')).toBeVisible();
    });
  }
});

test('the add sheet worked by keyboard alone, on the space’s day', async ({ page }) => {
  const record = await openCoaches(page, 1440);
  await expect(heading(page)).toBeFocused();

  const row = rowOf(page, COACH_IDS.karim).getByRole('button', { name: 'Karim Haddad' });
  for (
    let presses = 0;
    presses < 6 && !(await row.evaluate((el) => el === document.activeElement));
    presses++
  ) {
    await page.keyboard.press('Tab');
  }
  await expect(row).toBeFocused();
  await page.keyboard.press('Enter');
  const sheet = sheetOf(page, 'Karim Haddad');
  await expect(sheet.locator('li.line')).toHaveCount(4);

  const addLine = sheet.getByRole('button', { name: 'Add a line' });
  for (
    let presses = 0;
    presses < 6 && !(await addLine.evaluate((el) => el === document.activeElement));
    presses++
  ) {
    await page.keyboard.press('Tab');
  }
  await expect(addLine).toBeFocused();
  await page.keyboard.press('Enter');
  const add = sheetOf(page, 'Add a line');
  await expect(add).toBeVisible();

  const words = add.getByLabel('What they showed');
  for (
    let presses = 0;
    presses < 6 && !(await words.evaluate((el) => el === document.activeElement));
    presses++
  ) {
    await page.keyboard.press('Tab');
  }
  await expect(words).toBeFocused();
  await page.keyboard.type('Owns Iron House gym in Hamra');

  await page.keyboard.press('Tab');
  const shownOn = kitDateField(add, 'Shown on').locator('button.trigger');
  await expect(shownOn).toBeFocused();
  await page.keyboard.press('Enter');
  const today = add.locator(`button.day[data-date="${TODAY}"]`);
  await expect(today).toBeFocused();
  // The space's today is the last day, wherever the device is (the far-zone project is a day ahead).
  await expect(add.locator('button.day[data-date="2026-10-10"]')).toHaveAttribute(
    'aria-disabled',
    'true',
  );
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await expect(add.locator('button.day[data-date="2026-10-07"]')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(shownOn).toContainText('Oct 7, 2026');
  await expect(shownOn).toBeFocused();

  // Back to the words, and Enter sends the form.
  await page.keyboard.press('Shift+Tab');
  await expect(words).toBeFocused();
  await page.keyboard.press('Enter');

  await expect(page.getByRole('dialog')).toHaveCount(1);
  expect(record.writes.add).toEqual([
    { what: 'Owns Iron House gym in Hamra', shownOn: '2026-10-07' },
  ]);
  await expect(page.getByText('Line added.')).toBeVisible();
  await expect(sheet.getByRole('button', { name: 'Add a line' })).toBeFocused();
});

test('search, the row as a target, a former coach and the way back to Platform billing', async ({
  page,
}) => {
  await openCoaches(page, 1440, false, '/admin/billing');
  await page.locator('.top-actions').getByRole('link', { name: 'Coaches' }).click();
  await expect(page).toHaveURL(/\/admin\/coaches$/);
  await expect(heading(page)).toBeFocused();

  await page.getByLabel('Search coaches').fill('omar');
  await expect(page.locator('li.coach .role')).toHaveText([
    'Coach · Atlas Performance',
    'Coach · Beirut Barbell',
  ]);
  await expect(page.getByRole('status')).toHaveText('2 coaches');
  await page.getByLabel('Search coaches').fill('nobody here');
  await expect(page.locator('[data-no-match]')).toContainText('No coach matches “nobody here”.');
  await expect(page.getByRole('status')).toHaveText('No coach matches');
  await page.locator('[data-no-match]').getByRole('button', { name: 'Clear search' }).click();
  await expect(page.locator('li.coach')).toHaveCount(6);
  await expect(page.getByLabel('Search coaches')).toBeFocused();

  // The whole row opens the sheet, not only the name.
  await rowOf(page, COACH_IDS.nadine).click({ position: { x: 600, y: 20 } });
  const sheet = sheetOf(page, 'Nadine Saliba');
  await expect(sheet.locator('[data-former]')).toHaveText(
    'They no longer coach in this space, so no line can be added. Their lines can still be taken down or erased.',
  );
  await expect(sheet.getByRole('button', { name: 'Add a line' })).toHaveCount(0);
  await expect(sheet.getByRole('button', { name: /^Take down/ })).toBeVisible();
  await expect(sheet.getByRole('button', { name: 'Erase on request' })).toBeVisible();
  await axe(page);
  await page.screenshot({ path: 'test-results/n4a-former-1440.png' });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await page.locator('a[data-back]').click();
  await expect(page).toHaveURL(/\/admin\/billing$/);
  await expect(page.getByRole('heading', { name: 'Platform billing', level: 1 })).toBeVisible();
});

test('the list and a sheet reflow at 200% text, and read right to left', async ({ page }) => {
  await openCoaches(page, 390);
  await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
  await expect(page.locator('li.coach')).toHaveCount(6);
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: 'test-results/n4a-list-200.png', fullPage: true });

  await rowOf(page, COACH_IDS.karim).getByRole('button', { name: 'Karim Haddad' }).click();
  const sheet = sheetOf(page, 'Karim Haddad');
  await expect(sheet.locator('li.line')).toHaveCount(4);
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: 'test-results/n4a-sheet-200.png' });
  await page.keyboard.press('Escape');

  await useRtl(page);
  await expect(rowOf(page, COACH_IDS.sami, SPACE_IDS.arz).locator('.role bdi')).toHaveText(
    'نادي الأرز',
  );
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: 'test-results/n4a-list-rtl-390.png', fullPage: true });
});
