import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, Subject, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthStore } from '../../core/auth/auth.store';
import { CsrfService } from '../../core/security/csrf.service';
import { chooseDay, chosenDay, fill, press, query, settle } from '../../../testing/dom';
import {
  CERTIFICATE_WORD_REFUSAL,
  certificateCoaches,
  certificateLine,
  certificateLines,
  COACH_IDS,
  confirmedLine,
  SPACE_IDS,
  takenDownLine,
  TODAY,
} from '../../../testing/platform-admin-fixtures';
import { PlatformCoaches } from './platform-coaches';
import { PlatformCoachesApi } from './platform-coaches-api';
import type { AddedLine, CertificateCoach, CertificateLines } from './platform-coaches.models';

type Api = { [K in keyof PlatformCoachesApi]: ReturnType<typeof vi.fn> };

const NEVER = /\b(verified|certified|licensed|qualified|approved)\b/i;

const ADMIN = {
  id: 'admin-1',
  email: 'hicham@tbgym.example',
  displayName: ' Hicham Haddad ',
  preferredCulture: 'en-LB',
  emailConfirmed: true,
  roles: ['PlatformAdmin'],
};

/** Each coach's lines as the server would answer them. */
function linesFor(userId: string, tenantId: string): CertificateLines {
  const coach = certificateCoaches().find(
    (item) => item.userId === userId && item.tenantId === tenantId,
  )!;
  const base = { ...coach, spaceToday: TODAY };
  if (userId === COACH_IDS.karim) return certificateLines();
  if (userId === COACH_IDS.nadine) {
    return {
      ...base,
      lines: [
        confirmedLine({
          id: 'line-degree',
          text: 'BSc Sport Science, AUB, shown to TB Gym on 1 Oct 2026',
          what: 'BSc Sport Science, AUB',
        }),
      ],
    };
  }
  return { ...base, lines: [] };
}

async function render(
  overrides: Partial<Api> = {},
  coaches: () => CertificateCoach[] = certificateCoaches,
) {
  const api: Api = {
    getCoaches: vi.fn(() => of(coaches())),
    getLines: vi.fn((userId: string, tenantId: string) => of(linesFor(userId, tenantId))),
    addLine: vi.fn(() => of({ line: certificateLine({ id: 'line-new' }), created: true })),
    confirmLine: vi.fn(() => of(confirmedLine())),
    dropLine: vi.fn(() => of('line-gym')),
    takeDownLine: vi.fn(() => of(takenDownLine())),
    erase: vi.fn(() => of({ erased: 2, dropped: 1 })),
    ...overrides,
  };
  const csrf = { refresh: vi.fn(() => Promise.resolve()) };
  TestBed.configureTestingModule({
    imports: [PlatformCoaches],
    providers: [
      provideRouter([]),
      { provide: PlatformCoachesApi, useValue: api },
      { provide: CsrfService, useValue: csrf },
      { provide: AuthStore, useValue: { user: signal(ADMIN) } },
    ],
  });
  const fixture = TestBed.createComponent(PlatformCoaches);
  await settle(fixture);
  return { fixture, host: fixture.nativeElement as HTMLElement, api, csrf };
}

const textOf = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

/** Every sheet and dialog open, the newest last; the CDK draws them outside the page. */
const overlays = () => Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]'));
const top = () => overlays().at(-1) ?? null;
const titleOf = (overlay: HTMLElement | null) =>
  textOf(overlay ? document.getElementById(overlay.getAttribute('aria-labelledby')!) : null);

const toast = () => textOf(document.querySelector('app-toast-host'));

const rows = (host: HTMLElement) => Array.from(host.querySelectorAll<HTMLElement>('li.coach'));
const rowTexts = (host: HTMLElement) =>
  rows(host).map((row) =>
    ['.name', '.email', '.role', '.count'].map((part) => textOf(row.querySelector(part))),
  );

async function openRow(
  fixture: Awaited<ReturnType<typeof render>>['fixture'],
  host: HTMLElement,
  userId: string,
  tenantId: string = SPACE_IDS.atlas,
): Promise<HTMLElement> {
  query<HTMLButtonElement>(
    host,
    `li[data-coach="${userId}"][data-space="${tenantId}"] button.name`,
  ).click();
  await settle(fixture);
  return top()!;
}

/** The pill's tone, read from the class it draws with; neutral draws with none. */
const toneOf = (pill: Element) =>
  ['success', 'warning', 'danger', 'info', 'warm'].find((tone) => pill.classList.contains(tone)) ??
  'neutral';

const line = (sheet: HTMLElement, id: string) => query<HTMLElement>(sheet, `[data-line="${id}"]`);

const lineAction = (sheet: HTMLElement, id: string, action: string) =>
  query<HTMLButtonElement>(line(sheet, id), `[data-${action}]`);

describe('Coaches, the certificate record (notes plan N4a)', () => {
  afterEach(() => {
    vi.useRealTimers();
    document.body.querySelectorAll('.cdk-overlay-container').forEach((node) => node.remove());
    TestBed.resetTestingModule();
  });

  describe('the list', () => {
    it('lists every coach of every space with their role there and their lines, heading first', async () => {
      const { host, api } = await render();

      expect(document.activeElement).toBe(host.querySelector('h1'));
      expect(textOf(host.querySelector('h1'))).toBe('Coaches');
      expect(textOf(host.querySelector('.lede'))).toBe(
        'What TB Gym shows a coach’s clients about them: one line per proof, confirmed over WhatsApp. Text only, never a copy of a document, and a coach can have it erased on request.',
      );
      expect(host.querySelector('a[data-back]')?.getAttribute('href')).toBe('/admin/billing');
      expect(textOf(host.querySelector('a[data-back]'))).toBe('Platform billing');
      expect(api.getCoaches).toHaveBeenCalledTimes(1);
      expect(rowTexts(host)).toEqual([
        [
          'Karim Haddad',
          'karim@atlas.example',
          'Owner · Atlas Performance',
          '3 lines · 1 waiting · 1 taken down · 1 erased',
        ],
        ['Lea Khoury', 'lea@atlas.example', 'Coach · Atlas Performance', 'No lines yet'],
        ['Nadine Saliba', 'nadine@atlas.example', 'Former coach · Atlas Performance', '1 line'],
        ['Omar Nassar', 'omar@atlas.example', 'Coach · Atlas Performance', '1 line · 1 waiting'],
        ['Omar Nassar', 'omar@atlas.example', 'Coach · Beirut Barbell', 'No lines yet'],
        ['سامي الخوري', 'sami@arz.example', 'Owner · نادي الأرز', 'No lines · 2 erased'],
      ]);
      expect(textOf(host.querySelector('[role="status"]'))).toBe('6 coaches');
      // The space's name is isolated, and the name says which space through its description.
      const omarInBeirut = query<HTMLButtonElement>(
        host,
        `li[data-coach="${COACH_IDS.omar}"][data-space="${SPACE_IDS.beirut}"] button.name`,
      );
      const described = omarInBeirut
        .getAttribute('aria-describedby')!
        .split(' ')
        .map((id) => textOf(document.getElementById(id)));
      expect(described).toEqual(['Coach · Beirut Barbell', 'No lines yet']);
      expect(textOf(rows(host)[5].querySelector('.role bdi'))).toBe('نادي الأرز');
      expect(host.querySelector('li.coach app-status-pill')).toBeNull();
    });

    it('searches by coach, email or space, says how many it shows, and clears', async () => {
      const { fixture, host } = await render();
      const status = () => textOf(host.querySelector('[role="status"]'));

      fill(host, 'Search coaches', 'omar');
      await settle(fixture);
      expect(rowTexts(host).map(([name, , role]) => `${name} ${role}`)).toEqual([
        'Omar Nassar Coach · Atlas Performance',
        'Omar Nassar Coach · Beirut Barbell',
      ]);
      expect(status()).toBe('2 coaches');

      fill(host, 'Search coaches', 'BEIRUT');
      await settle(fixture);
      expect(rows(host)).toHaveLength(1);
      expect(status()).toBe('1 coach');

      fill(host, 'Search coaches', 'lea@atlas');
      await settle(fixture);
      expect(rowTexts(host)[0][0]).toBe('Lea Khoury');

      fill(host, 'Search coaches', ' nobody ');
      await settle(fixture);
      expect(rows(host)).toHaveLength(0);
      expect(status()).toBe('No coach matches');
      expect(textOf(host.querySelector('[data-no-match] p'))).toBe('No coach matches “nobody”.');

      press(host, 'Clear search');
      await settle(fixture);
      expect(rows(host)).toHaveLength(6);
      expect(status()).toBe('6 coaches');
      expect(document.activeElement).toBe(host.querySelector('input[type="search"]'));
    });

    it('clears the search with the box’s own button too', async () => {
      const { fixture, host } = await render();

      fill(host, 'Search coaches', 'karim');
      await settle(fixture);
      expect(rows(host)).toHaveLength(1);
      query<HTMLButtonElement>(host, 'button.clear[aria-label="Clear search"]').click();
      await settle(fixture);

      expect(rows(host)).toHaveLength(6);
      expect(host.querySelector('button.clear')).toBeNull();
      expect(document.activeElement).toBe(host.querySelector('input[type="search"]'));
    });

    it('says so when no coaching space has an owner or a coach yet', async () => {
      const { host } = await render({}, () => []);

      expect(textOf(host.querySelector('app-empty-state h2'))).toBe('No coaches yet');
      expect(textOf(host.querySelector('app-empty-state p'))).toBe(
        'A coaching space’s owner and coaches appear here.',
      );
      expect(host.querySelector('input[type="search"]')).toBeNull();
    });

    it('says so when the coaches cannot be loaded, and tries again', async () => {
      let failing = true;
      const { fixture, host, api } = await render({
        getCoaches: vi.fn(() =>
          failing
            ? throwError(() => new HttpErrorResponse({ status: 500 }))
            : of(certificateCoaches()),
        ),
      });

      expect(textOf(host.querySelector('[role="alert"]'))).toBe('The coaches couldn’t be loaded.');
      expect(rows(host)).toHaveLength(0);

      failing = false;
      press(host, 'Try again');
      await settle(fixture);

      expect(api.getCoaches).toHaveBeenCalledTimes(2);
      expect(host.querySelector('[role="alert"]')).toBeNull();
      expect(rows(host)).toHaveLength(6);
    });
  });

  describe('a coach’s sheet', () => {
    it('opens on the row with their lines, newest first, each with its pill and who acted', async () => {
      const { fixture, host, api } = await render();

      const sheet = await openRow(fixture, host, COACH_IDS.karim);

      expect(api.getLines).toHaveBeenCalledWith(COACH_IDS.karim, SPACE_IDS.atlas);
      expect(titleOf(sheet)).toBe('Karim Haddad');
      expect(textOf(sheet.querySelector('.about'))).toBe(
        'Owner · Atlas Performance karim@atlas.example',
      );
      const lines = Array.from(sheet.querySelectorAll<HTMLElement>('li.line'));
      expect(
        lines.map((item) => [
          textOf(item.querySelector('[data-sentence], [data-erased]')),
          textOf(item.querySelector('app-status-pill')),
          textOf(item.querySelector('[data-by]')),
        ]),
      ).toEqual([
        [
          'Owns Iron House gym in Hamra, shown to TB Gym on 8 Oct 2026',
          'Waiting for confirmation',
          'Recorded by Hicham Haddad',
        ],
        [
          'NASM CPT, 2019, shown to TB Gym on 1 Oct 2026',
          'Shown to clients',
          'Confirmed by Tarek Bou · recorded by Hicham Haddad',
        ],
        [
          'Six years coaching, shown to TB Gym on 10 Aug 2026',
          'Taken down 20 Aug 2026',
          'Confirmed and recorded by Hicham Haddad',
        ],
        [
          'Erased at the coach’s request',
          'Erased 2 Jul 2026',
          'Asked on 1 Jul 2026 · erased by Hicham Haddad',
        ],
      ]);
      expect(lines[0].querySelector('[data-sentence] bdi')).not.toBeNull();
      expect(lines.map((item) => toneOf(item.querySelector('app-status-pill')!))).toEqual([
        'warning',
        'success',
        'neutral',
        'neutral',
      ]);
      // What can be done to each line, its name saying which line.
      expect(
        lines.map((item) =>
          Array.from(item.querySelectorAll('.actions button')).map((action) => textOf(action)),
        ),
      ).toEqual([
        [
          'Mark confirmed Owns Iron House gym in Hamra, shown to TB Gym on 8 Oct 2026',
          'Drop Owns Iron House gym in Hamra, shown to TB Gym on 8 Oct 2026',
        ],
        ['Take down NASM CPT, 2019, shown to TB Gym on 1 Oct 2026'],
        [],
        [],
      ]);
      expect(textOf(sheet.querySelector('[data-add-line]'))).toBe('Add a line');
      expect(textOf(sheet.querySelector('[data-erase]'))).toBe('Erase on request');
      expect(sheet.querySelector('[data-former]')).toBeNull();
    });

    it('says when the coach hides a confirmed line from their clients, which TB Gym can still take down (notes plan N4b)', async () => {
      const { fixture, host } = await render({
        getLines: vi.fn(() =>
          of(
            certificateLines({
              lines: [
                confirmedLine({ coachShows: false }),
                confirmedLine({
                  id: 'line-degree',
                  text: 'BSc Sport Science, AUB, shown to TB Gym on 1 Oct 2026',
                  what: 'BSc Sport Science, AUB',
                }),
                takenDownLine({ coachShows: false }),
              ],
            }),
          ),
        ),
      });

      const sheet = await openRow(fixture, host, COACH_IDS.karim);

      const hidden = line(sheet, 'line-nasm');
      const pill = hidden.querySelector('app-status-pill')!;
      expect(textOf(pill)).toBe('Hidden by the coach');
      expect(toneOf(pill)).toBe('neutral');
      expect(textOf(hidden.querySelector('[data-by]'))).toBe(
        'Confirmed by Tarek Bou · recorded by Hicham Haddad',
      );
      expect(textOf(lineAction(sheet, 'line-nasm', 'take-down'))).toContain('Take down');
      // A line the coach shows says so; a taken-down one keeps its day whatever the switch said.
      const shown = line(sheet, 'line-degree').querySelector('app-status-pill')!;
      expect(textOf(shown)).toBe('Shown to clients');
      expect(toneOf(shown)).toBe('success');
      expect(textOf(line(sheet, 'line-years').querySelector('app-status-pill'))).toBe(
        'Taken down 20 Aug 2026',
      );
      expect(textOf(sheet)).not.toMatch(NEVER);
    });

    it('shows the lines being read, and a failed read’s Try again', async () => {
      const answers = new Subject<CertificateLines>();
      const { fixture, host, api } = await render({ getLines: vi.fn(() => answers) });

      const sheet = await openRow(fixture, host, COACH_IDS.karim);
      expect(textOf(sheet.querySelector('app-skeleton'))).toBe('Loading their lines…');
      expect(textOf(sheet.querySelector('.about'))).toBe(
        'Owner · Atlas Performance karim@atlas.example',
      );

      answers.error(new HttpErrorResponse({ status: 500 }));
      await settle(fixture);
      expect(textOf(sheet.querySelector('[role="alert"]'))).toBe('These lines couldn’t be loaded.');
      expect(sheet.querySelector('[data-add-line]')).toBeNull();

      api.getLines.mockImplementation(() => of(certificateLines()));
      press(sheet, 'Try again');
      await settle(fixture);
      expect(sheet.querySelectorAll('li.line')).toHaveLength(4);
      expect(sheet.querySelector('[role="alert"]')).toBeNull();
    });

    it('offers no Add for someone who no longer coaches there, only what their lines still allow', async () => {
      const { fixture, host } = await render();

      const sheet = await openRow(fixture, host, COACH_IDS.nadine);

      expect(textOf(sheet.querySelector('.about'))).toBe(
        'Former coach · Atlas Performance nadine@atlas.example',
      );
      expect(textOf(sheet.querySelector('[data-former]'))).toBe(
        'They no longer coach in this space, so no line can be added. Their lines can still be taken down or erased.',
      );
      expect(sheet.querySelector('[data-add-line]')).toBeNull();
      expect(Array.from(sheet.querySelectorAll('button')).map((b) => textOf(b))).not.toContain(
        'Add a line',
      );
      expect(textOf(lineAction(sheet, 'line-degree', 'take-down'))).toContain('Take down');
      expect(sheet.querySelector('[data-erase]')).not.toBeNull();
    });

    it('says there are no lines yet, with the hint only while they coach there', async () => {
      const { fixture, host } = await render();

      const sheet = await openRow(fixture, host, COACH_IDS.lea);
      expect(textOf(sheet.querySelector('[data-no-lines]'))).toBe(
        'No lines yet. Add one once the coach has shown TB Gym a certificate, a gym they own, years of coaching or a degree.',
      );
      expect(sheet.querySelector('[data-erase]')).toBeNull();
      expect(sheet.querySelector('[data-add-line]')).not.toBeNull();
    });

    it('says "No lines yet." alone for a former coach with none left', async () => {
      const { fixture, host } = await render({
        getLines: vi.fn(() =>
          of({ ...linesFor(COACH_IDS.nadine, SPACE_IDS.atlas), lines: [] } as CertificateLines),
        ),
      });

      const sheet = await openRow(fixture, host, COACH_IDS.nadine);
      expect(textOf(sheet.querySelector('[data-no-lines]'))).toBe('No lines yet.');
    });

    it('offers no erasure once every line is erased', async () => {
      const { fixture, host } = await render();

      const sheet = await openRow(fixture, host, COACH_IDS.sami, SPACE_IDS.arz);
      expect(sheet.querySelector('[data-erase]')).toBeNull();
    });
  });

  describe('adding a line', () => {
    it('opens on top of the coach’s sheet and adds it after reading the security token', async () => {
      const { fixture, host, api, csrf } = await render();
      const sheet = await openRow(fixture, host, COACH_IDS.karim);

      press(sheet, 'Add a line');
      await settle(fixture);
      expect(overlays()).toHaveLength(2);
      const add = top()!;
      expect(titleOf(add)).toBe('Add a line');
      expect(textOf(add.querySelector('.about'))).toBe('Karim Haddad · Atlas Performance');
      expect(textOf(add)).toContain(
        'In the coach’s own words: the certificate, the gym they own, the years they coached, the degree.',
      );
      expect(await chosenDay(fixture, add, 'Shown on')).toBe(TODAY);

      fill(add, 'What they showed', '  BSc Sport Science, AUB ');
      await settle(fixture);
      press(add, 'Add');
      await settle(fixture);

      expect(api.addLine).toHaveBeenCalledWith(
        COACH_IDS.karim,
        SPACE_IDS.atlas,
        'BSc Sport Science, AUB',
        TODAY,
      );
      expect(csrf.refresh.mock.invocationCallOrder[0]).toBeLessThan(
        api.addLine.mock.invocationCallOrder[0],
      );
      expect(overlays()).toEqual([sheet]);
      expect(toast()).toContain('Line added.');
      expect(api.getLines).toHaveBeenCalledTimes(2);
      expect(api.getCoaches).toHaveBeenCalledTimes(2);
    });

    it('says a line already on the record was not added twice', async () => {
      const { fixture, host } = await render({
        addLine: vi.fn(() => of({ line: certificateLine(), created: false })),
      });
      const sheet = await openRow(fixture, host, COACH_IDS.karim);

      press(sheet, 'Add a line');
      await settle(fixture);
      fill(top()!, 'What they showed', 'Owns Iron House gym in Hamra');
      press(top()!, 'Add');
      await settle(fixture);

      expect(toast()).toContain('That line is already on the record.');
      expect(toast()).not.toContain('Line added.');
    });

    it('shows the server’s refusal under its field with what was typed, and none of the five words', async () => {
      const { fixture, host } = await render({
        addLine: vi.fn(() =>
          throwError(
            () =>
              new HttpErrorResponse({
                status: 400,
                error: {
                  title: 'One or more errors.',
                  errors: { what: [CERTIFICATE_WORD_REFUSAL] },
                },
              }),
          ),
        ),
      });
      const sheet = await openRow(fixture, host, COACH_IDS.karim);
      press(sheet, 'Add a line');
      await settle(fixture);
      const add = top()!;

      fill(add, 'What they showed', 'Licensed trainer since 2019');
      await settle(fixture);
      press(add, 'Add');
      await settle(fixture);

      const box = query<HTMLInputElement>(add, 'input[name="what"]');
      const field = box.closest('app-field')!;
      expect(textOf(field.querySelector('.tb-field__support--error'))).toBe(
        CERTIFICATE_WORD_REFUSAL,
      );
      expect(box.getAttribute('aria-invalid')).toBe('true');
      expect(document.activeElement).toBe(box);
      expect(box.value).toBe('Licensed trainer since 2019');
      expect(overlays()).toHaveLength(2);
      expect(add.querySelector('[role="alert"]')).toBeNull();
      expect(document.body.textContent).not.toMatch(NEVER);

      // The refusal goes once the words change.
      fill(add, 'What they showed', 'NASM CPT, 2019');
      await settle(fixture);
      expect(field.querySelector('.tb-field__support--error')).toBeNull();
    });

    it('starts on the space’s today, never the device’s', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-10-12T12:00:00Z'));
      const { fixture, host } = await render();
      const sheet = await openRow(fixture, host, COACH_IDS.karim);

      press(sheet, 'Add a line');
      await settle(fixture);

      expect(await chosenDay(fixture, top()!, 'Shown on')).toBe(TODAY);
      expect(
        top()!.querySelector('button.day[data-date="2026-10-10"]')?.getAttribute('aria-disabled'),
      ).toBe('true');
    });

    it('keeps what was typed when the lines are read again meanwhile', async () => {
      const { fixture, host, api } = await render();
      const sheet = await openRow(fixture, host, COACH_IDS.karim);
      press(sheet, 'Add a line');
      await settle(fixture);
      const add = top()!;
      fill(add, 'What they showed', 'BSc Sport Science, AUB');
      await chooseDay(fixture, add, 'Shown on', '2026-10-05');

      // A write elsewhere, say, reads the lines again while the sheet is open.
      await (
        fixture.componentInstance as unknown as { loadLines(quiet: boolean): Promise<void> }
      ).loadLines(true);
      await settle(fixture);

      expect(api.getLines).toHaveBeenCalledTimes(2);
      expect(query<HTMLInputElement>(add, 'input[name="what"]').value).toBe(
        'BSc Sport Science, AUB',
      );
      expect(await chosenDay(fixture, add, 'Shown on')).toBe('2026-10-05');
    });

    it('asks before closing with typed work, and keeps it on Keep editing', async () => {
      const { fixture, host, api } = await render();
      const sheet = await openRow(fixture, host, COACH_IDS.karim);
      press(sheet, 'Add a line');
      await settle(fixture);
      const add = top()!;
      fill(add, 'What they showed', 'BSc Sport Science, AUB');
      await settle(fixture);

      query<HTMLButtonElement>(add, 'button[aria-label="Close"]').click();
      await settle(fixture);
      expect(titleOf(top())).toBe('Discard what you typed?');
      expect(textOf(top())).toContain('Close without saving? What you typed will be lost.');
      press(top()!, 'Keep editing');
      await settle(fixture);
      expect(top()).toBe(add);

      press(add, 'Not now');
      await settle(fixture);
      expect(titleOf(top())).toBe('Discard what you typed?');
      press(top()!, 'Discard');
      await settle(fixture);
      expect(overlays()).toEqual([sheet]);
      expect(api.addLine).not.toHaveBeenCalled();
    });

    it('closes at once on Not now with nothing typed', async () => {
      const { fixture, host } = await render();
      const sheet = await openRow(fixture, host, COACH_IDS.karim);
      press(sheet, 'Add a line');
      await settle(fixture);

      press(top()!, 'Not now');
      await settle(fixture);

      expect(overlays()).toEqual([sheet]);
    });

    it('stays open while its save runs, whichever way it is closed, so the answer lands', async () => {
      const answer = new Subject<AddedLine>();
      const { fixture, host, api } = await render({ addLine: vi.fn(() => answer) });
      const sheet = await openRow(fixture, host, COACH_IDS.karim);
      press(sheet, 'Add a line');
      await settle(fixture);
      const add = top()!;
      fill(add, 'What they showed', 'BSc Sport Science, AUB');
      await settle(fixture);
      press(add, 'Add');
      await settle(fixture);
      expect(api.addLine).toHaveBeenCalledTimes(1);

      // The close button and Not now while the server has not answered: the sheet stays, and nothing asks.
      query<HTMLButtonElement>(add, 'button[aria-label="Close"]').click();
      await settle(fixture);
      press(add, 'Not now');
      await settle(fixture);
      expect(overlays()).toEqual([sheet, add]);

      answer.next({ line: certificateLine({ id: 'line-new' }), created: true });
      answer.complete();
      await settle(fixture);
      expect(overlays()).toEqual([sheet]);
      expect(toast()).toContain('Line added.');
    });
  });

  describe('marking a line confirmed', () => {
    it('opens with the line and the signed-in admin’s name in the box, then confirms it', async () => {
      const { fixture, host, api, csrf } = await render();
      const sheet = await openRow(fixture, host, COACH_IDS.karim);

      lineAction(sheet, 'line-gym', 'confirm').click();
      await settle(fixture);
      const confirm = top()!;
      expect(overlays()).toHaveLength(2);
      expect(titleOf(confirm)).toBe('Mark confirmed');
      expect(textOf(confirm.querySelector('.about'))).toBe(
        'Owns Iron House gym in Hamra, shown to TB Gym on 8 Oct 2026',
      );
      expect(confirm.querySelector('.about bdi')).not.toBeNull();
      const box = query<HTMLInputElement>(confirm, 'input[name="confirmedByName"]');
      expect(box.value).toBe('Hicham Haddad');
      expect(box.maxLength).toBe(80);

      press(confirm, 'Confirm');
      await settle(fixture);

      expect(api.confirmLine).toHaveBeenCalledWith(
        COACH_IDS.karim,
        SPACE_IDS.atlas,
        'line-gym',
        'Hicham Haddad',
        1,
      );
      expect(csrf.refresh.mock.invocationCallOrder[0]).toBeLessThan(
        api.confirmLine.mock.invocationCallOrder[0],
      );
      expect(overlays()).toEqual([sheet]);
      expect(toast()).toContain('Line confirmed.');
      expect(api.getLines).toHaveBeenCalledTimes(2);
    });

    it('shows a conflict’s own sentence in the sheet', async () => {
      const { fixture, host } = await render({
        confirmLine: vi.fn(() =>
          throwError(
            () =>
              new HttpErrorResponse({
                status: 409,
                error: {
                  code: 'certificate_line_state',
                  message: 'This line is no longer waiting for confirmation. Read the lines again.',
                },
              }),
          ),
        ),
      });
      const sheet = await openRow(fixture, host, COACH_IDS.karim);
      lineAction(sheet, 'line-gym', 'confirm').click();
      await settle(fixture);

      press(top()!, 'Confirm');
      await settle(fixture);

      expect(textOf(top()!.querySelector('[role="alert"]'))).toBe(
        'This line is no longer waiting for confirmation. Read the lines again.',
      );
      expect(overlays()).toHaveLength(2);
    });
  });

  describe('dropping and taking down', () => {
    it('drops a waiting line after asking, and keeps it on Keep', async () => {
      const { fixture, host, api, csrf } = await render();
      const sheet = await openRow(fixture, host, COACH_IDS.karim);

      lineAction(sheet, 'line-gym', 'drop').click();
      await settle(fixture);
      expect(overlays()).toHaveLength(2);
      expect(titleOf(top())).toBe('Drop this line?');
      expect(textOf(top()!.querySelector('app-confirm .message'))).toBe(
        'Nothing about it is kept.',
      );
      press(top()!, 'Keep');
      await settle(fixture);
      expect(api.dropLine).not.toHaveBeenCalled();
      expect(overlays()).toEqual([sheet]);

      lineAction(sheet, 'line-gym', 'drop').click();
      await settle(fixture);
      press(top()!, 'Drop');
      await settle(fixture);

      expect(api.dropLine).toHaveBeenCalledWith(COACH_IDS.karim, SPACE_IDS.atlas, 'line-gym', 1);
      expect(csrf.refresh.mock.invocationCallOrder[0]).toBeLessThan(
        api.dropLine.mock.invocationCallOrder[0],
      );
      expect(toast()).toContain('Line dropped.');
      expect(api.getLines).toHaveBeenCalledTimes(2);
      expect(api.getCoaches).toHaveBeenCalledTimes(2);
    });

    it('takes a confirmed line down after asking', async () => {
      const { fixture, host, api, csrf } = await render();
      const sheet = await openRow(fixture, host, COACH_IDS.karim);

      lineAction(sheet, 'line-nasm', 'take-down').click();
      await settle(fixture);
      expect(titleOf(top())).toBe('Take this line down?');
      expect(textOf(top()!.querySelector('app-confirm .message'))).toBe(
        'The coach’s clients stop seeing it at once. TB Gym keeps the words for the keeping period, then erases them.',
      );
      press(top()!, 'Take down');
      await settle(fixture);

      expect(api.takeDownLine).toHaveBeenCalledWith(
        COACH_IDS.karim,
        SPACE_IDS.atlas,
        'line-nasm',
        2,
      );
      expect(csrf.refresh.mock.invocationCallOrder[0]).toBeLessThan(
        api.takeDownLine.mock.invocationCallOrder[0],
      );
      expect(toast()).toContain('Line taken down.');
      expect(overlays()).toEqual([sheet]);
    });

    it('says a conflict’s own sentence in a toast and reads the lines again', async () => {
      const { fixture, host, api } = await render({
        takeDownLine: vi.fn(() =>
          throwError(
            () =>
              new HttpErrorResponse({
                status: 409,
                error: {
                  code: 'certificate_line_changed',
                  message:
                    'This line changed since the page read it. Read the lines again, then try once more.',
                },
              }),
          ),
        ),
      });
      const sheet = await openRow(fixture, host, COACH_IDS.karim);

      lineAction(sheet, 'line-nasm', 'take-down').click();
      await settle(fixture);
      press(top()!, 'Take down');
      await settle(fixture);

      expect(toast()).toContain(
        'This line changed since the page read it. Read the lines again, then try once more.',
      );
      expect(api.getLines).toHaveBeenCalledTimes(2);
      expect(overlays()).toEqual([sheet]);
    });

    it('gives focus to the sheet’s title when the button that had it went with its line', async () => {
      let dropped = false;
      const { fixture, host } = await render({
        getLines: vi.fn(() =>
          of(
            dropped
              ? certificateLines({ lines: certificateLines().lines.slice(1) })
              : certificateLines(),
          ),
        ),
        dropLine: vi.fn(() => {
          dropped = true;
          return of('line-gym');
        }),
      });
      const sheet = await openRow(fixture, host, COACH_IDS.karim);

      const drop = lineAction(sheet, 'line-gym', 'drop');
      drop.focus();
      drop.click();
      await settle(fixture);
      press(top()!, 'Drop');
      await settle(fixture);

      expect(sheet.querySelector('[data-line="line-gym"]')).toBeNull();
      expect(document.activeElement).toBe(
        document.getElementById(sheet.getAttribute('aria-labelledby')!),
      );
    });
  });

  describe('erasing on request', () => {
    it('asks the day of the request, says by when it is met, and erases only after asking', async () => {
      const { fixture, host, api, csrf } = await render();
      const sheet = await openRow(fixture, host, COACH_IDS.karim);

      press(sheet, 'Erase on request');
      await settle(fixture);
      const erase = top()!;
      expect(overlays()).toHaveLength(2);
      expect(titleOf(erase)).toBe('Erase on request');
      expect(textOf(erase.querySelector('.about'))).toBe('Karim Haddad · Atlas Performance');
      expect(await chosenDay(fixture, erase, 'The day the coach asked')).toBe(TODAY);
      expect(textOf(erase.querySelector('[data-deadline]'))).toBe(
        'Requests are met within 10 days: by 19 Oct 2026.',
      );

      await chooseDay(fixture, erase, 'The day the coach asked', '2026-10-05');
      expect(textOf(erase.querySelector('[data-deadline]'))).toBe(
        'Requests are met within 10 days: by 15 Oct 2026.',
      );

      press(erase, 'Erase');
      await settle(fixture);
      expect(overlays()).toHaveLength(3);
      expect(titleOf(top())).toBe('Erase every line of this coach in this space?');
      expect(textOf(top()!.querySelector('app-confirm .message'))).toBe(
        'The words are gone for good; the dates and who acted stay.',
      );
      press(top()!, 'Keep');
      await settle(fixture);
      expect(api.erase).not.toHaveBeenCalled();
      expect(top()).toBe(erase);

      press(erase, 'Erase');
      await settle(fixture);
      press(top()!, 'Erase');
      await settle(fixture);

      expect(api.erase).toHaveBeenCalledWith(COACH_IDS.karim, SPACE_IDS.atlas, '2026-10-05');
      expect(csrf.refresh.mock.invocationCallOrder[0]).toBeLessThan(
        api.erase.mock.invocationCallOrder[0],
      );
      expect(overlays()).toEqual([sheet]);
      expect(toast()).toContain('Erased 2 lines and dropped 1 waiting line.');
      expect(api.getLines).toHaveBeenCalledTimes(2);
    });

    it('shows a refused day under its field', async () => {
      const { fixture, host } = await render({
        erase: vi.fn(() =>
          throwError(
            () =>
              new HttpErrorResponse({
                status: 400,
                error: { errors: { requestedOn: ['Choose today or an earlier day.'] } },
              }),
          ),
        ),
      });
      const sheet = await openRow(fixture, host, COACH_IDS.karim);
      press(sheet, 'Erase on request');
      await settle(fixture);
      const erase = top()!;

      press(erase, 'Erase');
      await settle(fixture);
      press(top()!, 'Erase');
      await settle(fixture);

      expect(top()).toBe(erase);
      const field = query<HTMLElement>(erase, 'app-date-field');
      expect(textOf(field.querySelector('.tb-field__support--error'))).toBe(
        'Choose today or an earlier day.',
      );
      expect(field.querySelector('button.trigger')?.getAttribute('aria-invalid')).toBe('true');
    });
  });

  it('holds none of the five words in any state, a refusal and the toasts included', async () => {
    const seen: string[] = [];
    const look = () => seen.push(document.body.textContent ?? '');
    const { fixture, host } = await render({
      addLine: vi.fn(() =>
        throwError(
          () =>
            new HttpErrorResponse({
              status: 400,
              error: { errors: { what: [CERTIFICATE_WORD_REFUSAL] } },
            }),
        ),
      ),
    });
    look();
    const sheet = await openRow(fixture, host, COACH_IDS.karim);
    look();

    press(sheet, 'Add a line');
    await settle(fixture);
    fill(top()!, 'What they showed', 'Approved and verified coach');
    press(top()!, 'Add');
    await settle(fixture);
    look();
    press(top()!, 'Not now');
    await settle(fixture);
    look();
    press(top()!, 'Discard');
    await settle(fixture);

    lineAction(sheet, 'line-gym', 'confirm').click();
    await settle(fixture);
    look();
    press(top()!, 'Confirm');
    await settle(fixture);
    look();

    lineAction(sheet, 'line-gym', 'drop').click();
    await settle(fixture);
    look();
    press(top()!, 'Drop');
    await settle(fixture);

    lineAction(sheet, 'line-nasm', 'take-down').click();
    await settle(fixture);
    look();
    press(top()!, 'Take down');
    await settle(fixture);

    press(sheet, 'Erase on request');
    await settle(fixture);
    look();
    press(top()!, 'Erase');
    await settle(fixture);
    look();
    press(top()!, 'Erase');
    await settle(fixture);
    look();

    await openRow(fixture, host, COACH_IDS.nadine);
    look();

    expect(seen).toHaveLength(12);
    for (const text of seen) expect(text).not.toMatch(NEVER);
    expect(toast()).toContain('Erased 2 lines and dropped 1 waiting line.');
  });

  it('closes its sheets when the page goes', async () => {
    const { fixture, host } = await render();
    const sheet = await openRow(fixture, host, COACH_IDS.karim);
    press(sheet, 'Add a line');
    await settle(fixture);
    expect(overlays()).toHaveLength(2);

    fixture.destroy();
    await new Promise((resolve) => setTimeout(resolve));

    expect(overlays()).toHaveLength(0);
  });
});
