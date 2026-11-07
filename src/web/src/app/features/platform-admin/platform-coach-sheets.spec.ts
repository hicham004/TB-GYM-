import { HttpErrorResponse } from '@angular/common/http';
import type { OutputRef, Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CsrfService } from '../../core/security/csrf.service';
import { chooseDay, chosenDay, fill, press, query, settle } from '../../../testing/dom';
import {
  CERTIFICATE_WORD_REFUSAL,
  certificateCoach,
  certificateLine,
  certificateLines,
  COACH_IDS,
  confirmedLine,
  erasedLine,
  SPACE_IDS,
  TODAY,
} from '../../../testing/platform-admin-fixtures';
import {
  PlatformCoachAdd,
  PlatformCoachConfirm,
  PlatformCoachErase,
  PlatformCoachLines,
} from './platform-coach-sheets';
import { PlatformCoachesApi } from './platform-coaches-api';

type CoachesApi = { [K in keyof PlatformCoachesApi]: ReturnType<typeof vi.fn> };

interface SheetOutputs {
  readonly closed: OutputRef<unknown>;
  readonly dirtyChange: OutputRef<boolean>;
}

const NEVER = /\b(verified|certified|licensed|qualified|approved)\b/i;
const KARIM = certificateLines();

async function render<T extends SheetOutputs>(
  component: Type<T>,
  inputs: Record<string, unknown>,
  overrides: Partial<CoachesApi> = {},
) {
  const api: CoachesApi = {
    getCoaches: vi.fn(),
    getLines: vi.fn(),
    addLine: vi.fn(() => of({ line: certificateLine({ id: 'line-new' }), created: true })),
    confirmLine: vi.fn(() => of(confirmedLine({ id: 'line-gym' }))),
    dropLine: vi.fn(),
    takeDownLine: vi.fn(),
    erase: vi.fn(() => of({ erased: 3, dropped: 1 })),
    ...overrides,
  };
  const csrf = { refresh: vi.fn(() => Promise.resolve()) };
  TestBed.configureTestingModule({
    providers: [
      { provide: PlatformCoachesApi, useValue: api },
      { provide: CsrfService, useValue: csrf },
    ],
  });
  const fixture = TestBed.createComponent(component);
  for (const [name, value] of Object.entries(inputs)) fixture.componentRef.setInput(name, value);
  const closed: unknown[] = [];
  const dirty: boolean[] = [];
  fixture.componentInstance.closed.subscribe((value) => closed.push(value));
  fixture.componentInstance.dirtyChange.subscribe((value) => dirty.push(value));
  await settle(fixture);
  return { fixture, host: fixture.nativeElement as HTMLElement, api, csrf, closed, dirty };
}

const textOf = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

/** The message under the field whose control matches `selector`. */
const fieldError = (host: HTMLElement, selector: string) =>
  textOf(
    query<HTMLElement>(host, selector)
      .closest('app-field, app-date-field')
      ?.querySelector('.tb-field__support--error'),
  );

const badRequest = (errors: Record<string, string[]>) =>
  new HttpErrorResponse({ status: 400, error: { title: 'One or more errors.', errors } });

const conflict = (code: string, message: string) =>
  new HttpErrorResponse({ status: 409, error: { code, message } });

/** The dialog the CDK draws outside the component. */
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');

describe('The Coaches page’s sheets (notes plan N4a)', () => {
  afterEach(() => {
    document.body.querySelectorAll('.cdk-overlay-container').forEach((node) => node.remove());
    TestBed.resetTestingModule();
  });

  describe('adding a line', () => {
    const inputs = { coach: KARIM };

    it('names the coach and the space, and starts on the space’s today, untouched', async () => {
      const view = await render(PlatformCoachAdd, inputs);

      expect(textOf(view.host.querySelector('.about'))).toBe('Karim Haddad · Atlas Performance');
      expect(textOf(view.host)).toContain(
        'In the coach’s own words: the certificate, the gym they own, the years they coached, the degree.',
      );
      const words = query<HTMLInputElement>(view.host, 'input[name="what"]');
      expect(words.maxLength).toBe(120);
      expect(words.getAttribute('dir')).toBe('auto');
      expect(await chosenDay(view.fixture, view.host, 'Shown on')).toBe(TODAY);
      expect(
        view.host
          .querySelector('button.day[data-date="2026-10-10"]')
          ?.getAttribute('aria-disabled'),
      ).toBe('true');
      expect(view.dirty.at(-1)).toBe(false);
      expect(textOf(view.host)).not.toMatch(NEVER);
    });

    it('asks for the words before sending, and puts focus there', async () => {
      const view = await render(PlatformCoachAdd, inputs);

      press(view.host, 'Add');
      await settle(view.fixture);

      expect(view.api.addLine).not.toHaveBeenCalled();
      expect(textOf(view.host.querySelector('[role="alert"]'))).toBe(
        'Check the fields marked above.',
      );
      expect(fieldError(view.host, 'input[name="what"]')).toBe(
        'Write what the coach showed: the certificate, the gym, the years.',
      );
      expect(document.activeElement?.getAttribute('name')).toBe('what');
    });

    it('holds typed work once words are typed or the day moves from today', async () => {
      const view = await render(PlatformCoachAdd, inputs);

      fill(view.host, 'What they showed', 'NASM');
      await settle(view.fixture);
      expect(view.dirty.at(-1)).toBe(true);
      fill(view.host, 'What they showed', '  ');
      await settle(view.fixture);
      expect(view.dirty.at(-1)).toBe(false);
      await chooseDay(view.fixture, view.host, 'Shown on', '2026-10-02');
      expect(view.dirty.at(-1)).toBe(true);
    });

    it('sends the words and the chosen day after reading the security token, and says it is new', async () => {
      const added = { line: certificateLine({ id: 'line-new' }), created: true };
      const view = await render(PlatformCoachAdd, inputs, { addLine: vi.fn(() => of(added)) });

      fill(view.host, 'What they showed', '  BSc Sport Science, AUB  ');
      await chooseDay(view.fixture, view.host, 'Shown on', '2026-10-02');
      press(view.host, 'Add');
      await settle(view.fixture);

      expect(view.api.addLine).toHaveBeenCalledWith(
        COACH_IDS.karim,
        SPACE_IDS.atlas,
        'BSc Sport Science, AUB',
        '2026-10-02',
      );
      expect(view.csrf.refresh.mock.invocationCallOrder[0]).toBeLessThan(
        view.api.addLine.mock.invocationCallOrder[0],
      );
      expect(view.closed).toEqual([added]);
    });

    it('hands on a line already on the record as not new', async () => {
      const existing = { line: certificateLine(), created: false };
      const view = await render(PlatformCoachAdd, inputs, { addLine: vi.fn(() => of(existing)) });

      fill(view.host, 'What they showed', 'Owns Iron House gym in Hamra');
      press(view.host, 'Add');
      await settle(view.fixture);

      expect(view.closed).toEqual([existing]);
    });

    it('puts each refused field’s sentence under it until that field changes', async () => {
      const view = await render(PlatformCoachAdd, inputs, {
        addLine: vi.fn(() =>
          throwError(() =>
            badRequest({
              what: [CERTIFICATE_WORD_REFUSAL],
              shownOn: ['Choose today or an earlier day.'],
            }),
          ),
        ),
      });

      fill(view.host, 'What they showed', 'Physio and coach');
      press(view.host, 'Add');
      await settle(view.fixture);

      expect(fieldError(view.host, 'input[name="what"]')).toBe(CERTIFICATE_WORD_REFUSAL);
      expect(fieldError(view.host, 'button.trigger')).toBe('Choose today or an earlier day.');
      expect(view.host.querySelector('[role="alert"]')).toBeNull();
      expect(document.activeElement?.getAttribute('name')).toBe('what');
      expect(view.closed).toEqual([]);
      expect(query<HTMLInputElement>(view.host, 'input[name="what"]').value).toBe(
        'Physio and coach',
      );

      fill(view.host, 'What they showed', 'BSc Physiotherapy, AUB');
      await settle(view.fixture);
      expect(fieldError(view.host, 'input[name="what"]')).toBe('');
      expect(fieldError(view.host, 'button.trigger')).toBe('Choose today or an earlier day.');
      await chooseDay(view.fixture, view.host, 'Shown on', '2026-10-01');
      expect(fieldError(view.host, 'button.trigger')).toBe('');
    });

    it('says the fallback when the coach is no longer found, keeping what was typed', async () => {
      const view = await render(PlatformCoachAdd, inputs, {
        addLine: vi.fn(() => throwError(() => new HttpErrorResponse({ status: 404 }))),
      });

      fill(view.host, 'What they showed', 'NASM CPT, 2019');
      press(view.host, 'Add');
      await settle(view.fixture);

      expect(textOf(view.host.querySelector('[role="alert"]'))).toBe(
        'The line couldn’t be added. Try again.',
      );
      expect(view.closed).toEqual([]);
    });

    it('closes without adding on Not now', async () => {
      const view = await render(PlatformCoachAdd, inputs);

      press(view.host, 'Not now');

      expect(view.closed).toEqual([false]);
      expect(view.api.addLine).not.toHaveBeenCalled();
    });
  });

  describe('marking a line confirmed', () => {
    const inputs = { coach: KARIM, line: certificateLine(), prefill: 'Hicham Haddad' };

    it('shows the line and the admin’s own name, untouched', async () => {
      const view = await render(PlatformCoachConfirm, inputs);

      expect(textOf(view.host.querySelector('[data-line-sentence]'))).toBe(
        'Owns Iron House gym in Hamra, shown to TB Gym on 8 Oct 2026',
      );
      const box = query<HTMLInputElement>(view.host, 'input[name="confirmedByName"]');
      expect(box.value).toBe('Hicham Haddad');
      expect(textOf(box.closest('app-field')?.querySelector('label'))).toBe(
        'Who confirmed it with the coach?',
      );
      expect(view.dirty.at(-1)).toBe(false);
      expect(textOf(view.host)).not.toMatch(NEVER);
    });

    it('confirms in one press for the admin, with the line’s version, after the token', async () => {
      const view = await render(PlatformCoachConfirm, inputs);

      press(view.host, 'Confirm');
      await settle(view.fixture);

      expect(view.api.confirmLine).toHaveBeenCalledWith(
        COACH_IDS.karim,
        SPACE_IDS.atlas,
        'line-gym',
        'Hicham Haddad',
        1,
      );
      expect(view.csrf.refresh.mock.invocationCallOrder[0]).toBeLessThan(
        view.api.confirmLine.mock.invocationCallOrder[0],
      );
      expect(view.closed).toEqual([confirmedLine({ id: 'line-gym' })]);
    });

    it('takes someone else’s name, and holds it as typed work', async () => {
      const view = await render(PlatformCoachConfirm, {
        ...inputs,
        line: certificateLine({ version: 4 }),
      });

      fill(view.host, 'Who confirmed it with the coach?', ' Tarek Bou ');
      await settle(view.fixture);
      expect(view.dirty.at(-1)).toBe(true);
      press(view.host, 'Confirm');
      await settle(view.fixture);

      expect(view.api.confirmLine).toHaveBeenCalledWith(
        COACH_IDS.karim,
        SPACE_IDS.atlas,
        'line-gym',
        'Tarek Bou',
        4,
      );
    });

    it('is not typed work when the name goes back to the admin’s own', async () => {
      const view = await render(PlatformCoachConfirm, inputs);

      fill(view.host, 'Who confirmed it with the coach?', 'Tarek');
      await settle(view.fixture);
      fill(view.host, 'Who confirmed it with the coach?', 'Hicham Haddad');
      await settle(view.fixture);

      expect(view.dirty.at(-1)).toBe(false);
    });

    it('asks who confirmed it when there is no name, and puts focus there', async () => {
      const view = await render(PlatformCoachConfirm, { ...inputs, prefill: '' });

      expect(query<HTMLInputElement>(view.host, 'input[name="confirmedByName"]').value).toBe('');
      press(view.host, 'Confirm');
      await settle(view.fixture);

      expect(view.api.confirmLine).not.toHaveBeenCalled();
      expect(fieldError(view.host, 'input[name="confirmedByName"]')).toBe(
        'Write who confirmed it with the coach.',
      );
      expect(document.activeElement?.getAttribute('name')).toBe('confirmedByName');
    });

    it('puts a refused name under the box, and a stale version’s sentence in the alert', async () => {
      const view = await render(PlatformCoachConfirm, inputs, {
        confirmLine: vi.fn(() =>
          throwError(() =>
            badRequest({
              confirmedByName: ['Use 80 characters or fewer.'],
              version: ['Read the lines again, then try once more.'],
            }),
          ),
        ),
      });

      press(view.host, 'Confirm');
      await settle(view.fixture);

      expect(fieldError(view.host, 'input[name="confirmedByName"]')).toBe(
        'Use 80 characters or fewer.',
      );
      expect(textOf(view.host.querySelector('[role="alert"]'))).toBe(
        'Read the lines again, then try once more.',
      );
      expect(view.closed).toEqual([]);
    });

    it('says a conflict’s own sentence', async () => {
      const view = await render(PlatformCoachConfirm, inputs, {
        confirmLine: vi.fn(() =>
          throwError(() =>
            conflict(
              'certificate_line_changed',
              'This line changed since the page read it. Read the lines again, then try once more.',
            ),
          ),
        ),
      });

      press(view.host, 'Confirm');
      await settle(view.fixture);

      expect(textOf(view.host.querySelector('[role="alert"]'))).toBe(
        'This line changed since the page read it. Read the lines again, then try once more.',
      );
    });
  });

  describe('erasing on request', () => {
    const inputs = { coach: KARIM };

    it('starts on the space’s today and says by when the request is met, live', async () => {
      const view = await render(PlatformCoachErase, inputs);

      expect(textOf(view.host.querySelector('.about'))).toBe('Karim Haddad · Atlas Performance');
      expect(await chosenDay(view.fixture, view.host, 'The day the coach asked')).toBe(TODAY);
      expect(textOf(view.host.querySelector('[data-deadline]'))).toBe(
        'Requests are met within 10 days: by 19 Oct 2026.',
      );
      expect(view.dirty.at(-1)).toBe(false);

      await chooseDay(view.fixture, view.host, 'The day the coach asked', '2026-09-28');
      expect(textOf(view.host.querySelector('[data-deadline]'))).toBe(
        'Requests are met within 10 days: by 8 Oct 2026.',
      );
      expect(view.dirty.at(-1)).toBe(true);
      expect(textOf(view.host)).not.toMatch(NEVER);
    });

    it('asks first, and sends nothing on Keep', async () => {
      const view = await render(PlatformCoachErase, inputs);

      press(view.host, 'Erase');
      await settle(view.fixture);

      expect(document.getElementById(dialog()!.getAttribute('aria-labelledby')!)?.textContent).toBe(
        'Erase every line of this coach in this space?',
      );
      expect(textOf(dialog()!.querySelector('app-confirm .message'))).toBe(
        'The words are gone for good; the dates and who acted stay.',
      );
      press(dialog()!, 'Keep');
      await settle(view.fixture);

      expect(dialog()).toBeNull();
      expect(view.api.erase).not.toHaveBeenCalled();
      expect(view.closed).toEqual([]);
    });

    it('erases from the day asked once Erase is answered, after the token, and hands on the counts', async () => {
      const view = await render(PlatformCoachErase, inputs);

      await chooseDay(view.fixture, view.host, 'The day the coach asked', '2026-10-06');
      press(view.host, 'Erase');
      await settle(view.fixture);
      press(dialog()!, 'Erase');
      await settle(view.fixture);

      expect(view.api.erase).toHaveBeenCalledWith(COACH_IDS.karim, SPACE_IDS.atlas, '2026-10-06');
      expect(view.csrf.refresh.mock.invocationCallOrder[0]).toBeLessThan(
        view.api.erase.mock.invocationCallOrder[0],
      );
      expect(view.closed).toEqual([{ erased: 3, dropped: 1 }]);
    });

    it('keeps a failure on screen in the sheet', async () => {
      const view = await render(PlatformCoachErase, inputs, {
        erase: vi.fn(() => throwError(() => new HttpErrorResponse({ status: 404 }))),
      });

      press(view.host, 'Erase');
      await settle(view.fixture);
      press(dialog()!, 'Erase');
      await settle(view.fixture);

      expect(textOf(view.host.querySelector('[role="alert"]'))).toBe(
        'The lines couldn’t be erased. Try again.',
      );
      expect(view.closed).toEqual([]);
    });

    it('closes its question when the sheet goes first', async () => {
      const view = await render(PlatformCoachErase, inputs);

      press(view.host, 'Erase');
      await settle(view.fixture);
      expect(dialog()).not.toBeNull();
      view.fixture.destroy();
      await new Promise((resolve) => setTimeout(resolve));

      expect(dialog()).toBeNull();
      expect(view.api.erase).not.toHaveBeenCalled();
    });
  });

  describe('a coach’s lines', () => {
    async function lines(inputs: Record<string, unknown>) {
      TestBed.configureTestingModule({});
      const fixture = TestBed.createComponent(PlatformCoachLines);
      fixture.componentRef.setInput('coach', certificateCoach());
      fixture.componentRef.setInput('state', 'ready');
      for (const [name, value] of Object.entries(inputs))
        fixture.componentRef.setInput(name, value);
      const emitted: string[] = [];
      const instance = fixture.componentInstance;
      instance.retry.subscribe(() => emitted.push('retry'));
      instance.add.subscribe(() => emitted.push('add'));
      instance.erase.subscribe(() => emitted.push('erase'));
      instance.confirmLine.subscribe((line) => emitted.push(`confirm ${line.id}`));
      instance.dropLine.subscribe((line) => emitted.push(`drop ${line.id}`));
      instance.takeDownLine.subscribe((line) => emitted.push(`take down ${line.id}`));
      await settle(fixture);
      return { fixture, host: fixture.nativeElement as HTMLElement, emitted };
    }

    it('hands each action to the page with the line it is for', async () => {
      const view = await lines({ lines: KARIM });

      query<HTMLButtonElement>(view.host, '[data-add-line]').click();
      query<HTMLButtonElement>(view.host, '[data-line="line-gym"] [data-confirm]').click();
      query<HTMLButtonElement>(view.host, '[data-line="line-gym"] [data-drop]').click();
      query<HTMLButtonElement>(view.host, '[data-line="line-nasm"] [data-take-down]').click();
      query<HTMLButtonElement>(view.host, '[data-erase]').click();

      expect(view.emitted).toEqual([
        'add',
        'confirm line-gym',
        'drop line-gym',
        'take down line-nasm',
        'erase',
      ]);
    });

    it('holds the buttons of a line being changed', async () => {
      const view = await lines({ lines: KARIM, working: 'line-gym' });

      const drop = query<HTMLButtonElement>(view.host, '[data-line="line-gym"] [data-drop]');
      expect(drop.getAttribute('aria-disabled')).toBe('true');
      drop.click();
      query<HTMLButtonElement>(view.host, '[data-line="line-gym"] [data-confirm]').click();

      expect(view.emitted).toEqual([]);
      expect(
        query<HTMLButtonElement>(
          view.host,
          '[data-line="line-nasm"] [data-take-down]',
        ).getAttribute('aria-disabled'),
      ).toBeNull();
    });

    it('says an erasure after the keeping period once, in place of the sentence', async () => {
      const view = await lines({
        lines: certificateLines({
          lines: [
            erasedLine({ erasureReason: 'KeepingPeriod', requestedOn: null, erasedByName: null }),
          ],
        }),
      });

      const item = query<HTMLElement>(view.host, 'li.line');
      expect(textOf(item.querySelector('[data-erased]'))).toBe('Erased after the keeping period');
      expect(item.querySelector('[data-by]')).toBeNull();
      expect(item.querySelector('.actions')).toBeNull();
      expect(view.host.querySelector('[data-erase]')).toBeNull();
    });

    it('says who it is about from the row while the lines are read, then from the lines', async () => {
      const view = await lines({ state: 'loading' });

      expect(textOf(view.host.querySelector('.about'))).toBe(
        'Owner · Atlas Performance karim@atlas.example',
      );
      expect(textOf(view.host.querySelector('app-skeleton'))).toBe('Loading their lines…');

      view.fixture.componentRef.setInput('state', 'ready');
      view.fixture.componentRef.setInput(
        'lines',
        certificateLines({ isActiveStaff: false, email: 'karim@iron.example', lines: [] }),
      );
      await settle(view.fixture);
      expect(textOf(view.host.querySelector('.about'))).toBe(
        'Former owner · Atlas Performance karim@iron.example',
      );
      expect(view.host.querySelector('[data-add-line]')).toBeNull();
    });

    it('offers to read the lines again after a failure', async () => {
      const view = await lines({ state: 'error' });

      expect(textOf(view.host.querySelector('[role="alert"]'))).toBe(
        'These lines couldn’t be loaded.',
      );
      press(view.host, 'Try again');
      expect(view.emitted).toEqual(['retry']);
    });
  });
});
