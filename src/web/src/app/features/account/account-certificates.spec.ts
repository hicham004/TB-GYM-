import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Observable, of, Subject, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { routes } from '../../app.routes';
import { authGuard, coachGuard } from '../../core/auth/auth.guards';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
import {
  ownHiddenLine,
  ownLines,
  ownShownLine,
  ownWaitingLine,
} from '../../../testing/account-certificates-fixtures';
import { press, query, settle, tick } from '../../../testing/dom';
import { BillingAccessApi } from '../billing/billing-access';
import { AccountCertificates } from './account-certificates';
import { AccountCertificatesApi } from './account-certificates-api';
import template from './account-certificates.html' with { loader: 'text' };
import type { OwnCertificateLine } from './account-certificates.models';

const NEVER = /\b(verified|certified|licensed|qualified|approved)\b/i;

const LEDE =
  'What TB Gym shows your clients about you. Switch a line off and your clients stop seeing it at once. TB Gym keeps only these words, never a copy of a document.';
const EMPTY =
  'No lines yet. Send TB Gym your certificates, the gym you own or the years you’ve coached, and each confirmed one appears here.';
const REFUSED = 'Couldn’t save your choice. Try again.';
const SAVING = 'Saving your choice…';
const SHOW = 'Show to my clients';

type Role = 'Owner' | 'Coach' | 'Client';

interface Options {
  /** The person's role in the open space; null when no space is open. A coach by default. */
  role?: Role | null;
  getOwn?: () => Observable<readonly OwnCertificateLine[]>;
  setShown?: (lineId: string, shown: boolean, version: number) => Observable<OwnCertificateLine>;
}

/** The server's answer to the switch: the line as the fixtures hold it, switched, one version on. */
const switched = (lineId: string, shown: boolean, version: number): OwnCertificateLine => ({
  ...ownLines().find((line) => line.id === lineId)!,
  coachShows: shown,
  version: version + 1,
});

async function render(options: Options = {}) {
  const role = options.role === undefined ? 'Coach' : options.role;
  const api = {
    getOwn: vi.fn(options.getOwn ?? (() => of(ownLines()))),
    setShown: vi.fn(
      options.setShown ??
        ((lineId: string, shown: boolean, version: number) => of(switched(lineId, shown, version))),
    ),
  };
  const csrf = { refresh: vi.fn(() => Promise.resolve()) };
  const access = {
    getAccess: vi.fn(() =>
      of({ isReadOnly: false, hasOverdueInvoice: false, readOnlyFrom: null, foundingCoach: null }),
    ),
  };
  const selectedTenantId = signal<string | null>(role === null ? null : 'tenant-1');
  const selectedMembership = signal<{ tenantId: string; role: Role } | undefined>(
    role === null ? undefined : { tenantId: 'tenant-1', role },
  );
  TestBed.configureTestingModule({
    imports: [AccountCertificates],
    providers: [
      provideRouter([]),
      { provide: AccountCertificatesApi, useValue: api },
      { provide: CsrfService, useValue: csrf },
      // The Settings frame reads the owner's billing access for their Founding coach row.
      { provide: BillingAccessApi, useValue: access },
      { provide: TenantStore, useValue: { selectedTenantId, selectedMembership } },
    ],
  });
  const fixture = TestBed.createComponent(AccountCertificates);
  await settle(fixture);
  /** Another coaching space opened from the account menu, with the person's role there. */
  const open = (tenantId: string, next: Role) => {
    selectedTenantId.set(tenantId);
    selectedMembership.set({ tenantId, role: next });
  };
  return { fixture, host: fixture.nativeElement as HTMLElement, api, csrf, access, open };
}

const textOf = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

/** The page itself, inside the Settings frame. */
const body = (host: HTMLElement) => query<HTMLElement>(host, '.body');
const lines = (host: HTMLElement) => Array.from(host.querySelectorAll<HTMLElement>('li.line'));
const lineOf = (host: HTMLElement, id: string) =>
  query<HTMLElement>(host, `li.line[data-line="${id}"]`);
const boxOf = (host: HTMLElement, id: string) =>
  lineOf(host, id).querySelector<HTMLInputElement>('input[type="checkbox"]');
const pillOf = (host: HTMLElement, id: string) =>
  textOf(lineOf(host, id).querySelector('app-status-pill'));
const statusOf = (host: HTMLElement, id: string) =>
  textOf(lineOf(host, id).querySelector('[role="status"]'));
/** Several confirmed lines each have a switch with the same label, so a press names its line. */
const flip = (host: HTMLElement, id: string, shown: boolean) => tick(lineOf(host, id), SHOW, shown);

/** The pill's tone, read from the class it draws with; neutral draws with none. */
const toneOf = (pill: Element) =>
  ['success', 'warning', 'danger', 'info', 'warm'].find((tone) => pill.classList.contains(tone)) ??
  'neutral';

const accountLinks = (host: HTMLElement) =>
  Array.from(
    host.querySelectorAll('[aria-labelledby="settings-group-account"] a'),
    (link) => [textOf(link), link.getAttribute('href')] as const,
  );

const conflict = (code: string) =>
  new HttpErrorResponse({ status: 409, error: { code, message: 'The line is not as it was.' } });

describe('Settings › Certificates (notes plan N4b)', () => {
  afterEach(() => TestBed.resetTestingModule());

  describe('the page', () => {
    it('opens to owners and coaches alone, as a Settings page of its own', async () => {
      const route = routes.find((item) => item.path === 'account/certificates')!;

      expect(route.canActivate).toEqual([authGuard, coachGuard]);
      expect(route.title).toBe('Certificates | TB Gym');
      expect(route.data).toEqual({ redesigned: true });
      expect(await (route.loadComponent as () => Promise<unknown>)()).toBe(AccountCertificates);
      // Before the address every other path falls to.
      expect(routes.indexOf(route)).toBeLessThan(routes.findIndex((item) => item.path === '**'));
    });

    it('names its place in the person’s account and what it is for while the lines are read', async () => {
      const { host } = await render({ getOwn: () => new Subject() });

      const head = query<HTMLElement>(host, 'header.top');
      expect(Array.from(head.children, (child) => textOf(child))).toEqual([
        'Your account',
        'Certificates',
        LEDE,
      ]);
      expect(head.querySelector('.kicker')?.tagName).toBe('P');
      expect(textOf(head.querySelector('h1'))).toBe('Certificates');
      expect(textOf(head.querySelector('.lede'))).toBe(LEDE);

      const loading = query<HTMLElement>(body(host), 'section[aria-busy="true"]');
      expect(textOf(loading.querySelector('app-skeleton'))).toBe('Loading your certificate lines…');
      expect(host.querySelector('li.line, input[type="checkbox"], [role="alert"]')).toBeNull();
    });

    it('sits in the Settings frame, listed in the coach’s own account after Password and security', async () => {
      const coach = await render();
      expect(accountLinks(coach.host)).toEqual([
        ['Notifications', '/notifications/settings'],
        ['Appearance', '/account/appearance'],
        ['Password and security', '/account/security'],
        ['Certificates', '/account/certificates'],
      ]);
      expect(coach.access.getAccess).not.toHaveBeenCalled();
      TestBed.resetTestingModule();

      const owner = await render({ role: 'Owner' });
      expect(accountLinks(owner.host).map(([label]) => label)).toEqual([
        'Notifications',
        'Appearance',
        'Password and security',
        'Certificates',
      ]);
      // The owner reads their own lines in their space, as a coach does.
      expect(owner.api.getOwn).toHaveBeenCalledTimes(1);
      expect(lines(owner.host)).toHaveLength(4);
    });
  });

  describe('the lines', () => {
    it('lists the lines in the server’s order, each sentence as it came with the pill of where it stands', async () => {
      const { host, api } = await render();

      expect(api.getOwn).toHaveBeenCalledTimes(1);
      const items = lines(host);
      expect(items.map((item) => item.getAttribute('data-line'))).toEqual([
        'line-years',
        'line-nasm',
        'line-degree',
        'line-gym',
      ]);
      expect(
        items.map((item) => [
          textOf(item.querySelector('[data-sentence]')),
          textOf(item.querySelector('app-status-pill')),
        ]),
      ).toEqual([
        ['Six years coaching, shown to TB Gym on 10 Aug 2026', 'Taken down 3 Nov 2026'],
        ['NASM CPT, 2019, shown to TB Gym on 1 Oct 2026', 'Shown to clients'],
        ['BSc Sport Science, AUB, shown to TB Gym on 3 Oct 2026', 'Hidden'],
        ['Owns Iron House gym in Hamra, shown to TB Gym on 8 Oct 2026', 'Waiting for TB Gym'],
      ]);
      expect(items.map((item) => toneOf(item.querySelector('app-status-pill')!))).toEqual([
        'neutral',
        'success',
        'neutral',
        'warning',
      ]);
      // Each sentence is isolated for a line in another script.
      for (const [index, item] of items.entries()) {
        const bdi = item.querySelector('[data-sentence] > bdi');
        expect(textOf(bdi)).toBe(ownLines()[index].text);
      }
      expect(textOf(host)).not.toMatch(NEVER);
    });

    it('gives a confirmed line alone its switch, labelled and told apart by its sentence', async () => {
      const { host } = await render();

      expect(
        lines(host).map((item) => item.querySelector('input[type="checkbox"]') !== null),
      ).toEqual([false, true, true, false]);
      for (const [id, shown] of [
        ['line-nasm', true],
        ['line-degree', false],
      ] as const) {
        const box = boxOf(host, id)!;
        expect(box.checked).toBe(shown);
        expect(box.disabled).toBe(false);
        const label = lineOf(host, id).querySelector('label')!;
        expect(textOf(label)).toBe(SHOW);
        expect(label.htmlFor).toBe(box.id);
        expect(box.getAttribute('aria-describedby')).toBe(`certificate-${id}`);
        expect(textOf(document.getElementById(`certificate-${id}`))).toBe(
          ownLines().find((line) => line.id === id)!.text,
        );
      }
      expect(host.querySelector('[role="status"], [role="alert"]')).toBeNull();
    });

    it('offers nothing that adds, edits or asks for a file', async () => {
      const { host } = await render();

      expect(body(host).querySelectorAll('input')).toHaveLength(2);
      expect(
        body(host).querySelector(
          'input:not([type="checkbox"]), textarea, select, button, [contenteditable]',
        ),
      ).toBeNull();
    });

    it('says what an empty page waits for', async () => {
      const { host } = await render({ getOwn: () => of([]) });

      const empty = query<HTMLElement>(host, '[data-certificates-empty]');
      expect(textOf(empty)).toBe(EMPTY);
      expect(host.querySelector('li.line, input[type="checkbox"], [role="alert"]')).toBeNull();
      expect(textOf(body(host))).not.toMatch(NEVER);
    });
  });

  describe('the switch', () => {
    it('saves a flip at once after a fresh token, says so under the switch, and draws the answer with its new version', async () => {
      const answer = new Subject<OwnCertificateLine>();
      const view = await render({ setShown: () => answer });

      const box = flip(view.host, 'line-nasm', false);
      await settle(view.fixture);

      expect(view.api.setShown).toHaveBeenCalledWith('line-nasm', false, 2);
      expect(view.csrf.refresh).toHaveBeenCalledTimes(1);
      expect(view.csrf.refresh.mock.invocationCallOrder[0]).toBeLessThan(
        view.api.setShown.mock.invocationCallOrder[0],
      );
      const status = lineOf(view.host, 'line-nasm').querySelector('[role="status"]')!;
      expect(textOf(status)).toBe(SAVING);
      expect(status.closest('.show')?.querySelector('app-checkbox')).not.toBeNull();
      expect(
        lineOf(view.host, 'line-nasm')
          .querySelector('app-checkbox')!
          .compareDocumentPosition(status) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      // Only that line says so, and its box stays enabled, so focus stays on it.
      expect(Array.from(view.host.querySelectorAll('[role="status"]'), textOf)).toEqual([SAVING]);
      expect(box.disabled).toBe(false);
      expect(box.checked).toBe(false);

      answer.next(ownShownLine({ coachShows: false, version: 3 }));
      answer.complete();
      await settle(view.fixture);
      expect(view.host.querySelector('[role="status"]')).toBeNull();
      expect(box.checked).toBe(false);
      expect(pillOf(view.host, 'line-nasm')).toBe('Hidden');

      // The next press sends the version the server answered with.
      view.api.setShown.mockImplementation((lineId: string, shown: boolean, version: number) =>
        of(switched(lineId, shown, version)),
      );
      flip(view.host, 'line-nasm', true);
      await settle(view.fixture);
      expect(view.api.setShown).toHaveBeenLastCalledWith('line-nasm', true, 3);
      expect(view.csrf.refresh).toHaveBeenCalledTimes(2);
      expect(view.csrf.refresh.mock.invocationCallOrder[1]).toBeLessThan(
        view.api.setShown.mock.invocationCallOrder[1],
      );
      expect(box.checked).toBe(true);
      expect(pillOf(view.host, 'line-nasm')).toBe('Shown to clients');
    });

    it('switches a hidden line on, and its clients see it from then', async () => {
      const view = await render();

      const box = flip(view.host, 'line-degree', true);
      await settle(view.fixture);

      expect(view.api.setShown).toHaveBeenCalledWith('line-degree', true, 4);
      expect(box.checked).toBe(true);
      expect(pillOf(view.host, 'line-degree')).toBe('Shown to clients');
      expect(toneOf(lineOf(view.host, 'line-degree').querySelector('app-status-pill')!)).toBe(
        'success',
      );
      // The other lines are as the server read them.
      expect(pillOf(view.host, 'line-nasm')).toBe('Shown to clients');
      expect(boxOf(view.host, 'line-nasm')!.checked).toBe(true);
    });

    it('draws what the server answers even when it differs from the press', async () => {
      // Switched on again from another device between the write and its read-back.
      const view = await render({ setShown: () => of(ownShownLine({ version: 3 })) });

      const box = flip(view.host, 'line-nasm', false);
      await settle(view.fixture);

      expect(box.checked).toBe(true);
      expect(pillOf(view.host, 'line-nasm')).toBe('Shown to clients');
      expect(view.host.querySelector('[role="alert"]')).toBeNull();
    });

    it('puts a press on that line back to the choice on its way while it saves, and sends nothing more', async () => {
      const answer = new Subject<OwnCertificateLine>();
      const view = await render({ setShown: () => answer });

      const box = flip(view.host, 'line-nasm', false);
      await settle(view.fixture);
      flip(view.host, 'line-nasm', true);
      expect(box.checked).toBe(false);
      await settle(view.fixture);
      expect(box.checked).toBe(false);
      expect(view.api.setShown).toHaveBeenCalledTimes(1);
      expect(view.csrf.refresh).toHaveBeenCalledTimes(1);

      answer.next(ownShownLine({ coachShows: false, version: 3 }));
      answer.complete();
      await settle(view.fixture);
      expect(box.checked).toBe(false);
      expect(pillOf(view.host, 'line-nasm')).toBe('Hidden');
    });

    it('saves two lines at once, each drawing its own answer', async () => {
      const answers = new Map<string, Subject<OwnCertificateLine>>();
      const view = await render({
        setShown: (lineId: string) => {
          const answer = new Subject<OwnCertificateLine>();
          answers.set(lineId, answer);
          return answer;
        },
      });

      const nasm = flip(view.host, 'line-nasm', false);
      const degree = flip(view.host, 'line-degree', true);
      await settle(view.fixture);
      expect(view.api.setShown.mock.calls).toEqual([
        ['line-nasm', false, 2],
        ['line-degree', true, 4],
      ]);
      expect(statusOf(view.host, 'line-nasm')).toBe(SAVING);
      expect(statusOf(view.host, 'line-degree')).toBe(SAVING);

      answers.get('line-degree')!.next(ownHiddenLine({ coachShows: true, version: 5 }));
      answers.get('line-degree')!.complete();
      await settle(view.fixture);
      expect(degree.checked).toBe(true);
      expect(pillOf(view.host, 'line-degree')).toBe('Shown to clients');
      expect(statusOf(view.host, 'line-degree')).toBe('');
      // The other line is still on its way, and its press still stands.
      expect(statusOf(view.host, 'line-nasm')).toBe(SAVING);
      expect(nasm.checked).toBe(false);

      answers.get('line-nasm')!.next(ownShownLine({ coachShows: false, version: 3 }));
      answers.get('line-nasm')!.complete();
      await settle(view.fixture);
      expect(nasm.checked).toBe(false);
      expect(pillOf(view.host, 'line-nasm')).toBe('Hidden');
      // Neither answer threw the other away.
      expect(degree.checked).toBe(true);
      expect(pillOf(view.host, 'line-degree')).toBe('Shown to clients');
      expect(view.host.querySelector('[role="status"]')).toBeNull();
    });
  });

  describe('a refused switch', () => {
    it('puts the box back to what the server holds, says so under that line, and reads the lines again', async () => {
      const view = await render({
        setShown: () => throwError(() => conflict('certificate_line_changed')),
      });
      const box = boxOf(view.host, 'line-nasm')!;
      box.focus();

      flip(view.host, 'line-nasm', false);
      await settle(view.fixture);

      expect(box.checked).toBe(true);
      expect(view.api.getOwn).toHaveBeenCalledTimes(2);
      const line = lineOf(view.host, 'line-nasm');
      const alert = line.querySelector('[role="alert"]')!;
      expect(textOf(alert)).toBe(REFUSED);
      expect(alert.id).toBe('certificate-line-nasm-error');
      expect(
        line.querySelector('.show')!.compareDocumentPosition(alert) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      // The switch is told apart by its line and by what went wrong with it.
      expect(box.getAttribute('aria-describedby')).toBe(
        'certificate-line-nasm certificate-line-nasm-error',
      );
      expect(Array.from(view.host.querySelectorAll('[role="alert"]'), textOf)).toEqual([REFUSED]);
      expect(boxOf(view.host, 'line-degree')!.getAttribute('aria-describedby')).toBe(
        'certificate-line-degree',
      );
      expect(view.host.querySelector('[role="status"]')).toBeNull();
      // The line is still a confirmed one, so focus stays on its box.
      expect(document.activeElement).toBe(box);
      expect(lines(view.host)).toHaveLength(4);
    });

    it('says the same short sentence whatever the refusal, and never the server’s words', async () => {
      for (const refusal of [
        conflict('certificate_line_changed'),
        conflict('certificate_line_state'),
        new HttpErrorResponse({ status: 404 }),
        new HttpErrorResponse({ status: 400, error: { errors: { version: ['Missing.'] } } }),
        new HttpErrorResponse({ status: 500 }),
        new HttpErrorResponse({ status: 0 }),
      ]) {
        const view = await render({ setShown: () => throwError(() => refusal) });

        const box = flip(view.host, 'line-nasm', false);
        await settle(view.fixture);

        expect(box.checked).toBe(true);
        expect(textOf(lineOf(view.host, 'line-nasm').querySelector('[role="alert"]'))).toBe(
          REFUSED,
        );
        expect(textOf(view.host)).not.toContain('The line is not as it was.');
        expect(view.api.getOwn).toHaveBeenCalledTimes(2);
        TestBed.resetTestingModule();
      }
    });

    it('puts the box back and sends nothing when the security token cannot be read', async () => {
      const view = await render();
      view.csrf.refresh.mockImplementation(() => Promise.reject(new Error('offline')));

      const box = flip(view.host, 'line-nasm', false);
      await settle(view.fixture);

      expect(view.api.setShown).not.toHaveBeenCalled();
      expect(box.checked).toBe(true);
      expect(textOf(lineOf(view.host, 'line-nasm').querySelector('[role="alert"]'))).toBe(REFUSED);
    });

    it('draws the server’s newer line after a stale save, and sends its version with the next press', async () => {
      // Switched off from another device meanwhile: the server holds version 3, off.
      let reads = 0;
      const view = await render({
        getOwn: () =>
          of(
            ++reads === 1
              ? ownLines()
              : ownLines().map((line) =>
                  line.id === 'line-nasm' ? { ...line, coachShows: false, version: 3 } : line,
                ),
          ),
        setShown: () => throwError(() => conflict('certificate_line_changed')),
      });

      const box = flip(view.host, 'line-nasm', false);
      await settle(view.fixture);
      // The press went with the version the page had read; the box now says what the server holds.
      expect(view.api.setShown).toHaveBeenCalledWith('line-nasm', false, 2);
      expect(box.checked).toBe(false);
      expect(pillOf(view.host, 'line-nasm')).toBe('Hidden');
      expect(textOf(lineOf(view.host, 'line-nasm').querySelector('[role="alert"]'))).toBe(REFUSED);

      view.api.setShown.mockImplementation((lineId: string, shown: boolean, version: number) =>
        of(switched(lineId, shown, version)),
      );
      flip(view.host, 'line-nasm', true);
      await settle(view.fixture);
      expect(view.api.setShown).toHaveBeenLastCalledWith('line-nasm', true, 3);
      expect(box.checked).toBe(true);
      expect(pillOf(view.host, 'line-nasm')).toBe('Shown to clients');
      // The next press took the refusal away, and what it said from the switch's description.
      expect(view.host.querySelector('[role="alert"]')).toBeNull();
      expect(box.getAttribute('aria-describedby')).toBe('certificate-line-nasm');
    });

    it('takes the switch away when the line came back taken down, and the heading takes focus', async () => {
      let takenDown = false;
      const view = await render({
        getOwn: () =>
          of(
            takenDown
              ? ownLines().map((line) =>
                  line.id === 'line-nasm'
                    ? {
                        ...line,
                        state: 'TakenDown' as const,
                        takenDownOn: '2026-11-06',
                        version: 3,
                      }
                    : line,
                )
              : ownLines(),
          ),
        setShown: () => throwError(() => conflict('certificate_line_state')),
      });
      takenDown = true;
      boxOf(view.host, 'line-nasm')!.focus();

      flip(view.host, 'line-nasm', false);
      await settle(view.fixture);

      expect(boxOf(view.host, 'line-nasm')).toBeNull();
      expect(pillOf(view.host, 'line-nasm')).toBe('Taken down 6 Nov 2026');
      expect(document.activeElement).toBe(view.host.querySelector('h1'));
      // The other switches are where they were.
      expect(boxOf(view.host, 'line-degree')).not.toBeNull();
    });

    it('lets the heading take focus when the line is gone from what the server now lists', async () => {
      let erased = false;
      const view = await render({
        getOwn: () =>
          of(erased ? ownLines().filter((line) => line.id !== 'line-nasm') : ownLines()),
        setShown: () => throwError(() => new HttpErrorResponse({ status: 404 })),
      });
      erased = true;
      boxOf(view.host, 'line-nasm')!.focus();

      flip(view.host, 'line-nasm', false);
      await settle(view.fixture);

      expect(view.host.querySelector('[data-line="line-nasm"]')).toBeNull();
      expect(lines(view.host)).toHaveLength(3);
      expect(document.activeElement).toBe(view.host.querySelector('h1'));
    });

    it('leaves focus where the coach moved it while a refused switch was read again', async () => {
      let takenDown = false;
      const view = await render({
        getOwn: () =>
          of(
            takenDown
              ? ownLines().map((line) =>
                  line.id === 'line-nasm'
                    ? { ...line, state: 'TakenDown' as const, takenDownOn: '2026-11-06' }
                    : line,
                )
              : ownLines(),
          ),
        setShown: () => throwError(() => conflict('certificate_line_state')),
      });
      const security = Array.from(view.host.querySelectorAll<HTMLAnchorElement>('nav a')).find(
        (link) => textOf(link) === 'Password and security',
      )!;
      takenDown = true;

      flip(view.host, 'line-nasm', false);
      security.focus();
      await settle(view.fixture);

      expect(boxOf(view.host, 'line-nasm')).toBeNull();
      expect(document.activeElement).toBe(security);
    });

    it('keeps the lines on screen when the read after a refusal fails too', async () => {
      let reads = 0;
      const view = await render({
        getOwn: () =>
          ++reads === 1 ? of(ownLines()) : throwError(() => new HttpErrorResponse({ status: 500 })),
        setShown: () => throwError(() => new HttpErrorResponse({ status: 500 })),
      });

      const box = flip(view.host, 'line-nasm', false);
      await settle(view.fixture);

      expect(view.api.getOwn).toHaveBeenCalledTimes(2);
      expect(lines(view.host)).toHaveLength(4);
      expect(box.checked).toBe(true);
      expect(Array.from(view.host.querySelectorAll('[role="alert"]'), textOf)).toEqual([REFUSED]);
      expect(view.host.querySelector('[data-certificates-nothing], .load-failed')).toBeNull();
    });

    it('puts a press during the read after a refusal back to what the server holds', async () => {
      const reread = new Subject<readonly OwnCertificateLine[]>();
      let reads = 0;
      const view = await render({
        getOwn: () => (++reads === 1 ? of(ownLines()) : reread),
        setShown: () => throwError(() => new HttpErrorResponse({ status: 500 })),
      });

      const box = flip(view.host, 'line-nasm', false);
      await settle(view.fixture);
      expect(box.checked).toBe(true);
      // The lines are read again: the box takes no new choice meanwhile, as while it saves.
      flip(view.host, 'line-nasm', false);
      expect(box.checked).toBe(true);
      await settle(view.fixture);
      expect(view.api.setShown).toHaveBeenCalledTimes(1);

      reread.next(ownLines());
      reread.complete();
      await settle(view.fixture);
      expect(box.checked).toBe(true);
      expect(view.api.setShown).toHaveBeenCalledTimes(1);
      expect(view.host.querySelector('[role="status"]')).toBeNull();
    });

    it('never has two saves of one line on their way at once, and says so while one is', async () => {
      const reread = new Subject<readonly OwnCertificateLine[]>();
      const later = new Subject<OwnCertificateLine>();
      let reads = 0;
      let saves = 0;
      let onItsWay = 0;
      let most = 0;
      const view = await render({
        getOwn: () => (++reads === 1 ? of(ownLines()) : reread),
        setShown: () =>
          ++saves === 1
            ? throwError(() => new HttpErrorResponse({ status: 500 }))
            : new Observable<OwnCertificateLine>((subscriber) => {
                most = Math.max(most, ++onItsWay);
                const answer = later.subscribe(subscriber);
                return () => {
                  onItsWay--;
                  answer.unsubscribe();
                };
              }),
      });
      const box = boxOf(view.host, 'line-nasm')!;
      const saying = () => statusOf(view.host, 'line-nasm') === SAVING;

      flip(view.host, 'line-nasm', false);
      await settle(view.fixture);
      // Pressed again while the refusal is read again, then again once the lines are back.
      flip(view.host, 'line-nasm', !box.checked);
      await settle(view.fixture);
      reread.next(ownLines());
      reread.complete();
      await settle(view.fixture);
      expect(saying()).toBe(onItsWay > 0);
      flip(view.host, 'line-nasm', !box.checked);
      await settle(view.fixture);
      expect(saying()).toBe(onItsWay > 0);
      expect(most).toBe(1);

      later.next(ownShownLine({ coachShows: false, version: 3 }));
      later.complete();
      await settle(view.fixture);
      expect(onItsWay).toBe(0);
      expect(view.host.querySelector('[role="status"]')).toBeNull();
    });

    it('never draws a read sent before another line’s save answered over that newer answer', async () => {
      const reread = new Subject<readonly OwnCertificateLine[]>();
      const degree = new Subject<OwnCertificateLine>();
      let reads = 0;
      const view = await render({
        getOwn: () => (++reads === 1 ? of(ownLines()) : reread),
        setShown: (lineId) =>
          lineId === 'line-degree'
            ? degree
            : throwError(() => conflict('certificate_line_changed')),
      });

      // The hidden line goes on while the other line's refusal sends the read of the lines.
      flip(view.host, 'line-degree', true);
      await settle(view.fixture);
      flip(view.host, 'line-nasm', false);
      await settle(view.fixture);
      // The save answers first; the read, made before that save, lands after it.
      degree.next(ownHiddenLine({ coachShows: true, version: 5 }));
      degree.complete();
      await settle(view.fixture);
      expect(pillOf(view.host, 'line-degree')).toBe('Shown to clients');
      reread.next(ownLines());
      reread.complete();
      await settle(view.fixture);

      expect(pillOf(view.host, 'line-degree')).toBe('Shown to clients');
      expect(boxOf(view.host, 'line-degree')!.checked).toBe(true);
      // The next press sends the version that answer gave.
      flip(view.host, 'line-degree', false);
      await settle(view.fixture);
      expect(view.api.setShown).toHaveBeenLastCalledWith('line-degree', false, 5);
    });

    it('says “Saving” only for a choice on its way, never for a line whose refusal is read again', async () => {
      const reread = new Subject<readonly OwnCertificateLine[]>();
      const degree = new Subject<OwnCertificateLine>();
      let reads = 0;
      const view = await render({
        getOwn: () => (++reads === 1 ? of(ownLines()) : reread),
        setShown: (lineId) =>
          lineId === 'line-degree'
            ? degree
            : throwError(() => conflict('certificate_line_changed')),
      });

      flip(view.host, 'line-nasm', false);
      await settle(view.fixture);
      // Another line pressed while the refused one's lines are read again.
      flip(view.host, 'line-degree', true);
      await settle(view.fixture);

      expect(statusOf(view.host, 'line-degree')).toBe(SAVING);
      expect(lineOf(view.host, 'line-nasm').querySelector('[role="status"]')).toBeNull();
      degree.next(ownHiddenLine({ coachShows: true, version: 5 }));
      degree.complete();
      reread.next(ownLines());
      reread.complete();
      await settle(view.fixture);
      expect(view.host.querySelector('[role="status"]')).toBeNull();
      expect(pillOf(view.host, 'line-degree')).toBe('Shown to clients');
    });

    it('says only the refusal while the lines are read again after it', async () => {
      const reread = new Subject<readonly OwnCertificateLine[]>();
      let reads = 0;
      const view = await render({
        getOwn: () => (++reads === 1 ? of(ownLines()) : reread),
        setShown: () => throwError(() => conflict('certificate_line_changed')),
      });

      flip(view.host, 'line-nasm', false);
      await settle(view.fixture);

      expect(textOf(lineOf(view.host, 'line-nasm').querySelector('[role="alert"]'))).toBe(REFUSED);
      expect(lineOf(view.host, 'line-nasm').querySelector('[role="status"]')).toBeNull();
      reread.next(ownLines());
      reread.complete();
      await settle(view.fixture);
      expect(textOf(lineOf(view.host, 'line-nasm').querySelector('[role="alert"]'))).toBe(REFUSED);
    });
  });

  describe('a read that does not answer the lines', () => {
    it('says nothing is here when the server refuses the read, with the way back to Settings', async () => {
      for (const [role, back] of [
        ['Coach', '/notifications/settings'],
        ['Owner', '/workspace'],
      ] as const) {
        for (const status of [403, 404]) {
          const { host } = await render({
            role,
            getOwn: () => throwError(() => new HttpErrorResponse({ status })),
          });
          const nothing = query<HTMLElement>(host, '[data-certificates-nothing]');
          expect(textOf(nothing.querySelector('h2'))).toBe('Nothing here');
          expect(textOf(nothing.querySelector('p'))).toBe(
            'This page is for the owner and the coaches of a coaching space.',
          );
          const link = nothing.querySelector('a')!;
          expect(textOf(link)).toBe('Back to Settings');
          expect(link.getAttribute('href')).toBe(back);
          expect(host.querySelector('li.line, [role="alert"]')).toBeNull();
          TestBed.resetTestingModule();
        }
      }
    });

    it('offers another try when the lines cannot be read, and reads them again', async () => {
      for (const status of [500, 0]) {
        let failing = true;
        const view = await render({
          getOwn: () =>
            failing ? throwError(() => new HttpErrorResponse({ status })) : of(ownLines()),
        });

        const failed = query<HTMLElement>(view.host, '.load-failed');
        expect(textOf(failed.querySelector('[role="alert"]'))).toBe(
          'Your certificate lines couldn’t be loaded.',
        );
        expect(view.host.querySelector('[data-certificates-nothing], li.line')).toBeNull();

        failing = false;
        press(view.host, 'Try again');
        await settle(view.fixture);
        expect(view.api.getOwn).toHaveBeenCalledTimes(2);
        expect(lines(view.host)).toHaveLength(4);
        expect(view.host.querySelector('[role="alert"]')).toBeNull();
        TestBed.resetTestingModule();
      }
    });

    it('shows the lines being read again after Try again', async () => {
      const again = new Subject<readonly OwnCertificateLine[]>();
      let reads = 0;
      const view = await render({
        getOwn: () =>
          ++reads === 1 ? throwError(() => new HttpErrorResponse({ status: 503 })) : again,
      });

      press(view.host, 'Try again');
      await settle(view.fixture);
      expect(view.host.querySelector('section[aria-busy="true"] app-skeleton')).not.toBeNull();
      expect(view.host.querySelector('.load-failed')).toBeNull();

      again.next([]);
      again.complete();
      await settle(view.fixture);
      expect(textOf(view.host.querySelector('[data-certificates-empty]'))).toBe(EMPTY);
    });

    it('asks the server nothing for a client or with no coaching space open, who find nothing here', async () => {
      const client = await render({ role: 'Client' });
      expect(client.api.getOwn).not.toHaveBeenCalled();
      const nothing = query<HTMLElement>(client.host, '[data-certificates-nothing]');
      expect(textOf(nothing.querySelector('h2'))).toBe('Nothing here');
      expect(textOf(nothing.querySelector('a'))).toBe('Back to Me');
      expect(nothing.querySelector('a')!.getAttribute('href')).toBe('/me');
      // A client has no Settings section of their own.
      expect(client.host.querySelector('nav[aria-label="Settings"]')).toBeNull();
      TestBed.resetTestingModule();

      const nobody = await render({ role: null });
      expect(nobody.api.getOwn).not.toHaveBeenCalled();
      const none = query<HTMLElement>(nobody.host, '[data-certificates-nothing]');
      expect(textOf(none.querySelector('a'))).toBe('Back to Today');
      expect(none.querySelector('a')!.getAttribute('href')).toBe('/');
    });
  });

  describe('another coaching space', () => {
    it('drops the old space’s lines at once and reads the new space’s', async () => {
      const next = new Subject<readonly OwnCertificateLine[]>();
      let reads = 0;
      const view = await render({ getOwn: () => (++reads === 1 ? of(ownLines()) : next) });
      expect(lines(view.host)).toHaveLength(4);

      view.open('tenant-2', 'Coach');
      await settle(view.fixture);
      expect(view.api.getOwn).toHaveBeenCalledTimes(2);
      expect(view.host.querySelector('li.line')).toBeNull();
      expect(textOf(view.host.querySelector('section[aria-busy="true"] app-skeleton'))).toBe(
        'Loading your certificate lines…',
      );
      expect(textOf(view.host)).not.toContain('NASM CPT');

      next.next([
        ownWaitingLine({
          id: 'line-barbell',
          text: 'Coaches at Beirut Barbell since 2021, shown to TB Gym on 5 Nov 2026',
          what: 'Coaches at Beirut Barbell since 2021',
          shownOn: '2026-11-05',
        }),
      ]);
      next.complete();
      await settle(view.fixture);
      expect(lines(view.host).map((item) => item.getAttribute('data-line'))).toEqual([
        'line-barbell',
      ]);
      expect(pillOf(view.host, 'line-barbell')).toBe('Waiting for TB Gym');
    });

    it('finds nothing here in a space where the person is a client, and asks nothing there', async () => {
      const view = await render();

      view.open('tenant-2', 'Client');
      await settle(view.fixture);

      expect(view.api.getOwn).toHaveBeenCalledTimes(1);
      expect(view.host.querySelector('li.line')).toBeNull();
      expect(view.host.querySelector('[data-certificates-nothing]')).not.toBeNull();
    });

    it('draws nothing of a switch saved in the space left meanwhile', async () => {
      const answer = new Subject<OwnCertificateLine>();
      const next = new Subject<readonly OwnCertificateLine[]>();
      let reads = 0;
      const view = await render({
        getOwn: () => (++reads === 1 ? of(ownLines()) : next),
        setShown: () => answer,
      });
      flip(view.host, 'line-nasm', false);
      await settle(view.fixture);
      expect(statusOf(view.host, 'line-nasm')).toBe(SAVING);

      view.open('tenant-2', 'Coach');
      await settle(view.fixture);
      expect(textOf(view.host)).not.toContain(SAVING);

      // Refused in the space left: nothing is said here, and nothing is read again for it.
      answer.error(conflict('certificate_line_changed'));
      await settle(view.fixture);
      expect(view.host.querySelector('.line [role="alert"]')).toBeNull();
      expect(view.api.getOwn).toHaveBeenCalledTimes(2);

      next.next([ownShownLine({ id: 'line-other' })]);
      next.complete();
      await settle(view.fixture);
      expect(boxOf(view.host, 'line-other')!.checked).toBe(true);
      expect(view.host.querySelector('[role="alert"], [role="status"]')).toBeNull();
    });
  });

  describe('the words', () => {
    it('never calls a coach checked, in its template as written', () => {
      expect(template.length).toBeGreaterThan(0);
      expect(template).not.toMatch(NEVER);
    });

    it('never calls a coach checked on screen, whatever the page shows', async () => {
      const shown: string[] = [];
      const pages: Options[] = [
        {},
        { getOwn: () => of([]) },
        { getOwn: () => throwError(() => new HttpErrorResponse({ status: 500 })) },
        { getOwn: () => throwError(() => new HttpErrorResponse({ status: 403 })) },
        { setShown: () => throwError(() => conflict('certificate_line_state')) },
      ];
      for (const options of pages) {
        const view = await render(options);
        if (options.setShown) {
          flip(view.host, 'line-nasm', false);
          await settle(view.fixture);
        }
        shown.push(textOf(view.host));
        TestBed.resetTestingModule();
      }

      expect(shown.join(' ')).toContain(REFUSED);
      for (const text of shown) {
        expect(text.length).toBeGreaterThan(0);
        expect(text).not.toMatch(NEVER);
      }
    });
  });
});
