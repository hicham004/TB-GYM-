import { HttpErrorResponse } from '@angular/common/http';
import type { OutputRef, Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CsrfService } from '../../core/security/csrf.service';
import { button, chooseDay, chosenDay, field, fill, press, settle } from '../../../testing/dom';
import {
  adminFounding,
  foundingTerms,
  SPACE_IDS,
  TODAY,
} from '../../../testing/platform-admin-fixtures';
import { PlatformFoundingApi } from './platform-founding-api';
import {
  PlatformFoundingEnd,
  PlatformFoundingMark,
  PlatformFoundingTerms,
} from './platform-founding-sheets';

type FoundingApi = { [K in keyof PlatformFoundingApi]: ReturnType<typeof vi.fn> };

interface SheetOutputs {
  readonly closed: OutputRef<unknown>;
  readonly dirtyChange: OutputRef<boolean>;
}

const NEVER = /\b(verified|certified|qualified|licensed|approved)\b/i;
const PUBLISHED = foundingTerms({ id: 'terms-2', versionNumber: 2, clientsWithActivePlan: 12 });

async function render<T extends SheetOutputs>(
  component: Type<T>,
  inputs: Record<string, unknown>,
  overrides: Partial<FoundingApi> = {},
) {
  const api: FoundingApi = {
    markFounding: vi.fn(() => of(adminFounding())),
    endFounding: vi.fn(() => of(adminFounding())),
    checkFounding: vi.fn(),
    getFoundingTerms: vi.fn(),
    publishFoundingTerms: vi.fn(() => of(PUBLISHED)),
    ...overrides,
  };
  const csrf = { refresh: vi.fn(() => Promise.resolve()) };
  TestBed.configureTestingModule({
    providers: [
      { provide: PlatformFoundingApi, useValue: api },
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

/** A refusal as the API sends it: a 409 with its code and its sentence. */
const refusal = (code: string, message: string) =>
  new HttpErrorResponse({ status: 409, error: { code, message } });

describe('The platform admin’s founding sheets (notes plan N3b)', () => {
  afterEach(() => {
    document.body.querySelectorAll('.cdk-overlay-container').forEach((node) => node.remove());
    TestBed.resetTestingModule();
  });

  describe('marking a space as founding', () => {
    const inputs = {
      tenantId: SPACE_IDS.atlas,
      spaceName: 'Atlas Performance',
      today: TODAY,
      terms: foundingTerms(),
    };

    it('says what the badge needs under the terms in force, and starts on today', async () => {
      const view = await render(PlatformFoundingMark, inputs);

      // No guarantee months are published in these terms (notes plan N8), and the notice says so.
      expect(textOf(view.host.querySelector('[data-founding-terms-sentence]'))).toBe(
        'The badge is earned once 10 of the space’s clients have an active plan and the space is 2 months old (the terms in force). The discount is separate: grant it on this page too. The space’s prices are not held: no guarantee months are published yet.',
      );
      expect(await chosenDay(view.fixture, view.host, 'Founding since')).toBe(TODAY);
      expect(textOf(view.host)).not.toMatch(NEVER);
      expect(view.dirty.at(-1)).toBe(false);
    });

    it('says how long the space keeps its plan version, from the months in the terms in force (N8)', async () => {
      const notice = (view: { host: HTMLElement }) =>
        textOf(view.host.querySelector('[data-founding-terms-sentence]'));
      const badge =
        'The badge is earned once 10 of the space’s clients have an active plan and the space is 2 months old (the terms in force). The discount is separate: grant it on this page too.';

      const held = await render(PlatformFoundingMark, {
        ...inputs,
        terms: foundingTerms({ priceGuaranteeMonths: 5 }),
      });
      expect(notice(held)).toBe(
        `${badge} The space keeps its plan version until 5 months after its last discount ends, or after its founding day when it has none.`,
      );
      expect(textOf(held.host)).not.toMatch(NEVER);
      TestBed.resetTestingModule();

      const one = await render(PlatformFoundingMark, {
        ...inputs,
        terms: foundingTerms({ priceGuaranteeMonths: 1 }),
      });
      expect(notice(one)).toBe(
        `${badge} The space keeps its plan version until 1 month after its last discount ends, or after its founding day when it has none.`,
      );
      TestBed.resetTestingModule();

      // No months after the last discount is a guarantee still: the version is kept while it runs.
      const none = await render(PlatformFoundingMark, {
        ...inputs,
        terms: foundingTerms({ priceGuaranteeMonths: 0 }),
      });
      expect(notice(none)).toBe(
        `${badge} The space keeps its plan version until its last discount ends; with no discount, only for its founding month.`,
      );
      TestBed.resetTestingModule();

      // The terms could not be read: no number of theirs is named, the months no more than the badge's.
      const unread = await render(PlatformFoundingMark, { ...inputs, terms: null });
      expect(notice(unread)).toBe(
        'The badge is earned under the terms in force. The discount is separate: grant it on this page too. The space keeps its plan version for as long as the terms in force say.',
      );
      expect(textOf(unread.host)).not.toMatch(NEVER);
    });

    it('says marking changes no access, and what the owner’s seat includes while founding (N11b)', async () => {
      const seat = (view: { host: HTMLElement }) =>
        textOf(view.host.querySelector('[data-founding-seat-sentence]'));
      const raised = await render(PlatformFoundingMark, {
        ...inputs,
        terms: foundingTerms({ foundingSeatIncludedClients: 13 }),
        planSeatClients: 5,
      });
      expect(textOf(raised.host.querySelector('.about'))).toBe(
        'Atlas Performance The space’s owner holds the badge once it is earned. Marking changes no access. While the space stays founding, its owner’s seat includes 13 clients (the terms in force).',
      );
      expect(textOf(raised.host)).not.toContain('no invoice');
      TestBed.resetTestingModule();

      const none = await render(PlatformFoundingMark, { ...inputs, planSeatClients: 5 });
      expect(seat(none)).toBe(
        'Marking changes no access. While the space stays founding, its owner’s seat includes what the price plan’s seat includes: no founding number above it is published yet.',
      );
      TestBed.resetTestingModule();

      // A number at or below the plan's seat is not above it: the larger applies.
      const below = await render(PlatformFoundingMark, {
        ...inputs,
        terms: foundingTerms({ foundingSeatIncludedClients: 5 }),
        planSeatClients: 5,
      });
      expect(seat(below)).toBe(seat(none));
      TestBed.resetTestingModule();

      const unread = await render(PlatformFoundingMark, { ...inputs, terms: null });
      expect(seat(unread)).toBe(
        'Marking changes no access. While the space stays founding, its owner’s seat includes what the terms in force give a founding seat.',
      );
      expect(textOf(unread.host)).not.toMatch(NEVER);
    });

    it('words a lighter version of the terms for one client and no months', async () => {
      const view = await render(PlatformFoundingMark, {
        ...inputs,
        terms: foundingTerms({ clientsWithActivePlan: 1, monthsSinceStart: 0 }),
      });

      expect(textOf(view.host.querySelector('[data-founding-terms-sentence]'))).toBe(
        'The badge is earned once 1 of the space’s clients has an active plan (the terms in force). The discount is separate: grant it on this page too. The space’s prices are not held: no guarantee months are published yet.',
      );
    });

    it('asks what it is for before sending, and puts focus there', async () => {
      const view = await render(PlatformFoundingMark, inputs);

      press(view.host, 'Mark as founding');
      await settle(view.fixture);

      expect(view.api.markFounding).not.toHaveBeenCalled();
      expect(textOf(view.host)).toContain('Check the fields marked above.');
      expect(textOf(view.host)).toContain(
        'Say what the founding status is for, in up to 200 characters.',
      );
      expect(document.activeElement?.getAttribute('name')).toBe('note');
    });

    it('marks the space on the chosen day after reading the security token', async () => {
      const view = await render(PlatformFoundingMark, inputs);

      fill(view.host, 'What it is for', ' One of the first ten coaches ');
      await settle(view.fixture);
      expect(view.dirty.at(-1)).toBe(true);
      press(view.host, 'Mark as founding');
      await settle(view.fixture);

      expect(view.api.markFounding).toHaveBeenCalledWith(
        SPACE_IDS.atlas,
        TODAY,
        'One of the first ten coaches',
      );
      expect(view.csrf.refresh.mock.invocationCallOrder[0]).toBeLessThan(
        view.api.markFounding.mock.invocationCallOrder[0],
      );
      expect(view.closed).toEqual([true]);
    });

    it('marks the space on an earlier day chosen in the calendar', async () => {
      const view = await render(PlatformFoundingMark, inputs);

      await chooseDay(view.fixture, view.host, 'Founding since', '2026-09-15');
      expect(view.dirty.at(-1)).toBe(true);
      fill(view.host, 'What it is for', 'One of the first ten coaches');
      press(view.host, 'Mark as founding');
      await settle(view.fixture);

      expect(view.api.markFounding).toHaveBeenCalledWith(
        SPACE_IDS.atlas,
        '2026-09-15',
        'One of the first ten coaches',
      );
    });

    it('keeps the server’s refusal on screen with what was typed', async () => {
      const view = await render(PlatformFoundingMark, inputs, {
        markFounding: vi.fn(() =>
          throwError(() =>
            refusal(
              'founding_exists',
              'This coaching space is already founding. End that status first to mark it again.',
            ),
          ),
        ),
      });

      fill(view.host, 'What it is for', 'One of the first ten coaches');
      press(view.host, 'Mark as founding');
      await settle(view.fixture);

      expect(textOf(view.host.querySelector('[role="alert"]'))).toBe(
        'This coaching space is already founding. End that status first to mark it again.',
      );
      expect(view.closed).toEqual([]);
      expect(view.host.querySelector<HTMLInputElement>('input[name="note"]')!.value).toBe(
        'One of the first ten coaches',
      );
    });

    it('closes without marking on Not now', async () => {
      const view = await render(PlatformFoundingMark, inputs);

      press(view.host, 'Not now');

      expect(view.closed).toEqual([false]);
      expect(view.api.markFounding).not.toHaveBeenCalled();
    });
  });

  describe('ending a founding status for cause', () => {
    const inputs = {
      foundingId: 'founding-1',
      spaceName: 'Atlas Performance',
      foundingSince: '2026-09-15',
    };

    it('offers the three causes over free text, and says what ending does', async () => {
      const view = await render(PlatformFoundingEnd, inputs);

      expect(textOf(view.host)).toContain('Founding since Sep 15, 2026');
      const presets = view.host.querySelector('[role="group"]')!;
      expect(presets.getAttribute('aria-label')).toBe('Fill in a common cause');
      expect(Array.from(presets.querySelectorAll('button')).map((b) => textOf(b))).toEqual([
        'Misrepresented qualifications',
        'Harm to clients',
        'The coach asked to end it',
      ]);
      expect(textOf(view.host)).toContain('Kept on record. Only TB Gym’s admin sees it.');
      expect(textOf(view.host)).toContain(
        'The badge leaves the coach’s account and their clients’ Me page at once. The discount is not changed: revoke it separately if it should end.',
      );
      // Notes plan N8: ending the status ends the held prices too, from next month's invoice.
      expect(textOf(view.host)).toContain(
        'From next month’s invoice, the owner’s seat includes what the price plan’s seat includes and held prices end: the latest price plan applies.',
      );
      expect(textOf(view.host)).toContain(
        'Extra clients already granted stay until you revoke them. To take only the badge away, the coach can hide it.',
      );
      expect(textOf(view.host.querySelector('.notice'))).toBe(
        'The badge leaves the coach’s account and their clients’ Me page at once. The discount is not changed: revoke it separately if it should end. From next month’s invoice, the owner’s seat includes what the price plan’s seat includes and held prices end: the latest price plan applies. Extra clients already granted stay until you revoke them. To take only the badge away, the coach can hide it.',
      );
      expect(textOf(view.host)).not.toMatch(NEVER);
    });

    it('fills the reason with a cause, which can still be changed, and ends it', async () => {
      const view = await render(PlatformFoundingEnd, inputs);

      press(view.host, 'The coach asked to end it');
      await settle(view.fixture);
      const reason = view.host.querySelector<HTMLTextAreaElement>('textarea')!;
      expect(reason.value).toBe('The coach asked to end it');
      expect(document.activeElement).toBe(reason);
      expect(view.dirty.at(-1)).toBe(true);
      fill(view.host, 'Why?', 'The coach asked to end it, by WhatsApp on 8 October');
      press(view.host, 'End founding status');
      await settle(view.fixture);

      expect(view.api.endFounding).toHaveBeenCalledWith(
        'founding-1',
        'The coach asked to end it, by WhatsApp on 8 October',
      );
      expect(view.csrf.refresh.mock.invocationCallOrder[0]).toBeLessThan(
        view.api.endFounding.mock.invocationCallOrder[0],
      );
      expect(view.closed).toEqual([true]);
    });

    it('asks why before sending', async () => {
      const view = await render(PlatformFoundingEnd, inputs);

      press(view.host, 'End founding status');
      await settle(view.fixture);

      expect(view.api.endFounding).not.toHaveBeenCalled();
      expect(textOf(view.host)).toContain(
        'Say why the founding status ends, in up to 500 characters.',
      );
      expect(document.activeElement?.tagName).toBe('TEXTAREA');
    });

    it('keeps the server’s refusal on screen', async () => {
      const view = await render(PlatformFoundingEnd, inputs, {
        endFounding: vi.fn(() =>
          throwError(() => refusal('founding_ended', 'This founding status already ended.')),
        ),
      });

      press(view.host, 'Harm to clients');
      press(view.host, 'End founding status');
      await settle(view.fixture);

      expect(textOf(view.host.querySelector('[role="alert"]'))).toBe(
        'This founding status already ended.',
      );
      expect(view.closed).toEqual([]);
    });
  });

  describe('changing the badge’s terms', () => {
    // The version in force names a founding seat's number (notes plan N11a); new thresholds keep it.
    const inputs = { current: foundingTerms({ foundingSeatIncludedClients: 13 }) };

    it('publishes only a change, against the version it saw', async () => {
      const view = await render(PlatformFoundingTerms, inputs);

      expect(textOf(view.host)).toContain(
        'Version 1 is in force. A new version applies at once to every founding space still waiting; a badge already earned stays earned.',
      );
      expect(button(view.host, 'Publish version 2').disabled).toBe(true);
      expect(view.dirty.at(-1)).toBe(false);

      fill(view.host, 'Clients with an active plan', '12');
      fill(view.host, 'Months since the space started', '3');
      fill(view.host, 'Note (optional)', ' After the first ten talks ');
      await settle(view.fixture);
      expect(
        Array.from(view.host.querySelectorAll('.changes li')).map((row) =>
          ['.what', '.from', '.to'].map((part) => textOf(row.querySelector(part))),
        ),
      ).toEqual([
        ['Clients with an active plan', '10', '12'],
        ['Months since the space started', '2', '3'],
      ]);
      expect(view.dirty.at(-1)).toBe(true);
      press(view.host, 'Publish version 2');
      await settle(view.fixture);

      expect(view.api.publishFoundingTerms).toHaveBeenCalledWith({
        clientsWithActivePlan: 12,
        monthsSinceStart: 3,
        note: 'After the first ten talks',
        expectedCurrentVersion: 1,
        foundingSeatIncludedClients: 13,
        priceGuaranteeMonths: null,
      });
      expect(view.csrf.refresh.mock.invocationCallOrder[0]).toBeLessThan(
        view.api.publishFoundingTerms.mock.invocationCallOrder[0],
      );
      expect(view.closed).toEqual([PUBLISHED]);
      expect(textOf(view.host)).not.toMatch(NEVER);
    });

    it('takes only whole numbers in range, in the server’s words', async () => {
      const view = await render(PlatformFoundingTerms, inputs);

      fill(view.host, 'Clients with an active plan', '2.5');
      fill(view.host, 'Months since the space started', '');
      await settle(view.fixture);
      press(view.host, 'Publish version 2');
      await settle(view.fixture);

      expect(view.api.publishFoundingTerms).not.toHaveBeenCalled();
      expect(textOf(view.host)).toContain('Enter a whole number from 1 to 1000.');
      expect(textOf(view.host)).toContain(
        'Enter how many whole months since the space started earn the badge.',
      );
      expect(document.activeElement?.getAttribute('name')).toBe('clientsWithActivePlan');

      fill(view.host, 'Clients with an active plan', '1001');
      fill(view.host, 'Months since the space started', '25');
      await settle(view.fixture);
      expect(textOf(view.host)).toContain('Enter a whole number from 1 to 1000.');
      expect(textOf(view.host)).toContain('Enter a whole number from 0 to 24.');
    });

    it('offers the founding seat’s clients as a third number, prefilled, beside the plan’s seat', async () => {
      const view = await render(PlatformFoundingTerms, { ...inputs, planSeatClients: 5 });

      const seat = view.host.querySelector<HTMLInputElement>(
        'input[name="foundingSeatIncludedClients"]',
      )!;
      expect(seat.value).toBe('13');
      expect(seat.getAttribute('min')).toBe('0');
      expect(seat.getAttribute('max')).toBe('1000');
      expect(textOf(view.host)).toContain('Clients a founding owner’s seat includes');
      expect(textOf(view.host)).toContain(
        'The price plan’s seat includes 5 clients; the larger applies. Leave it empty for none; a space already founding keeps the highest number it has had.',
      );
      expect(view.host.querySelectorAll('.changes li')).toHaveLength(0);
      TestBed.resetTestingModule();

      // No number in force: an empty box, and the help without the plan's when it is unknown.
      const none = await render(PlatformFoundingTerms, { current: foundingTerms() });
      expect(
        none.host.querySelector<HTMLInputElement>('input[name="foundingSeatIncludedClients"]')!
          .value,
      ).toBe('');
      expect(textOf(none.host)).toContain(
        'The price plan’s seat applies when it includes more. Leave it empty for none; a space already founding keeps the highest number it has had.',
      );
    });

    it('publishes a new founding number, listed in What changes, with the thresholds as they were', async () => {
      const view = await render(PlatformFoundingTerms, { ...inputs, planSeatClients: 5 });

      fill(view.host, 'Clients a founding owner’s seat includes', '27');
      await settle(view.fixture);
      expect(
        Array.from(view.host.querySelectorAll('.changes li')).map((row) =>
          ['.what', '.from', '.to'].map((part) => textOf(row.querySelector(part))),
        ),
      ).toEqual([['Clients a founding owner’s seat includes', '13', '27']]);
      expect(view.dirty.at(-1)).toBe(true);
      press(view.host, 'Publish version 2');
      await settle(view.fixture);

      expect(view.api.publishFoundingTerms).toHaveBeenCalledWith({
        clientsWithActivePlan: 10,
        monthsSinceStart: 2,
        note: null,
        expectedCurrentVersion: 1,
        foundingSeatIncludedClients: 27,
        priceGuaranteeMonths: null,
      });
    });

    it('publishes none when the box is emptied, and says so in What changes', async () => {
      const view = await render(PlatformFoundingTerms, inputs);

      fill(view.host, 'Clients a founding owner’s seat includes', '');
      await settle(view.fixture);
      expect(
        Array.from(view.host.querySelectorAll('.changes li')).map((row) =>
          ['.what', '.from', '.to'].map((part) => textOf(row.querySelector(part))),
        ),
      ).toEqual([['Clients a founding owner’s seat includes', '13', 'None']]);
      press(view.host, 'Publish version 2');
      await settle(view.fixture);

      expect(view.api.publishFoundingTerms).toHaveBeenCalledWith(
        expect.objectContaining({ foundingSeatIncludedClients: null }),
      );
    });

    it('takes the founding number from 0 to 1000 only, in the server’s words', async () => {
      const view = await render(PlatformFoundingTerms, inputs);

      fill(view.host, 'Clients a founding owner’s seat includes', '1001');
      await settle(view.fixture);
      press(view.host, 'Publish version 2');
      await settle(view.fixture);

      expect(view.api.publishFoundingTerms).not.toHaveBeenCalled();
      expect(textOf(view.host)).toContain(
        'Enter a whole number of clients from 0 to 1000, or none for what the price plan’s seat includes.',
      );
      expect(document.activeElement?.getAttribute('name')).toBe('foundingSeatIncludedClients');

      fill(view.host, 'Clients a founding owner’s seat includes', '0');
      await settle(view.fixture);
      press(view.host, 'Publish version 2');
      await settle(view.fixture);
      expect(view.api.publishFoundingTerms).toHaveBeenCalledWith(
        expect.objectContaining({ foundingSeatIncludedClients: 0 }),
      );
    });

    it('marks a founding seat the browser cannot read, never publishing it as none', async () => {
      const view = await render(PlatformFoundingTerms, inputs);
      const seat = view.host.querySelector<HTMLInputElement>(
        'input[name="foundingSeatIncludedClients"]',
      )!;
      // What a browser reports for "13e" in a number box: no number, and bad input.
      const typed = (valueAsNumber: number, badInput: boolean) => {
        Object.defineProperty(seat, 'valueAsNumber', {
          configurable: true,
          get: () => valueAsNumber,
        });
        Object.defineProperty(seat, 'validity', { configurable: true, get: () => ({ badInput }) });
        seat.dispatchEvent(new Event('input'));
      };

      typed(Number.NaN, true);
      await settle(view.fixture);
      expect(view.host.querySelectorAll('.changes li')).toHaveLength(0);
      press(view.host, 'Publish version 2');
      await settle(view.fixture);
      expect(view.api.publishFoundingTerms).not.toHaveBeenCalled();
      expect(textOf(view.host)).toContain(
        'Enter a whole number of clients from 0 to 1000, or none for what the price plan’s seat includes.',
      );
      expect(seat.getAttribute('aria-invalid')).toBe('true');

      typed(27, false);
      await settle(view.fixture);
      press(view.host, 'Publish version 2');
      await settle(view.fixture);
      expect(view.api.publishFoundingTerms).toHaveBeenCalledWith(
        expect.objectContaining({ foundingSeatIncludedClients: 27 }),
      );
    });

    // Notes plan N8: the months a founding space's prices are held, the fourth number of the terms.
    describe('the months a founding space’s prices are held (notes plan N8)', () => {
      const MONTHS = 'Months a founding space’s prices are held';
      const RANGE = 'Enter a whole number of months from 0 to 120, or none to hold no price.';
      // The version in force holds prices for 5 months, and names a founding seat's number too.
      const held = {
        current: foundingTerms({ foundingSeatIncludedClients: 13, priceGuaranteeMonths: 5 }),
      };
      const months = (view: { host: HTMLElement }) =>
        view.host.querySelector<HTMLInputElement>('input[name="priceGuaranteeMonths"]')!;
      const changes = (view: { host: HTMLElement }) =>
        Array.from(view.host.querySelectorAll('.changes li')).map((row) =>
          ['.what', '.from', '.to'].map((part) => textOf(row.querySelector(part))),
        );
      /** What the box is described by: its help, or its error once one shows. */
      const described = (box: HTMLInputElement) =>
        textOf(document.getElementById(box.getAttribute('aria-describedby') ?? ''));

      it('offers them as a fourth number after the founding seat’s, prefilled, from 0 to 120', async () => {
        const view = await render(PlatformFoundingTerms, { ...held, planSeatClients: 5 });

        expect(
          Array.from(view.host.querySelectorAll<HTMLInputElement>('input[type="number"]')).map(
            (box) => box.name,
          ),
        ).toEqual([
          'clientsWithActivePlan',
          'monthsSinceStart',
          'foundingSeatIncludedClients',
          'priceGuaranteeMonths',
        ]);
        const box = months(view);
        expect(box.value).toBe('5');
        expect(box.getAttribute('min')).toBe('0');
        expect(box.getAttribute('max')).toBe('120');
        expect(box.getAttribute('step')).toBe('1');
        // The box is the one its label names, and its help says what the months are counted from.
        expect(field(view.host, MONTHS)).toBe(box);
        expect(described(box)).toBe(
          'Counted from a space’s last discount, or from its founding day when it has no discount; until then it keeps the plan version of its founding day. Leave it empty to hold no price. The number in force applies to every founding space, those already founding too.',
        );
        expect(changes(view)).toEqual([]);
        expect(button(view.host, 'Publish version 2').disabled).toBe(true);
        expect(textOf(view.host)).not.toMatch(NEVER);
        TestBed.resetTestingModule();

        // No months in force: an empty box, which reads as none.
        const none = await render(PlatformFoundingTerms, { current: foundingTerms() });
        expect(months(none).value).toBe('');
        expect(changes(none)).toEqual([]);
      });

      it('publishes the months typed, listed in What changes from None, with the other numbers as they were', async () => {
        const view = await render(PlatformFoundingTerms, inputs);

        fill(view.host, MONTHS, '5');
        await settle(view.fixture);
        expect(changes(view)).toEqual([[MONTHS, 'None', '5']]);
        expect(view.dirty.at(-1)).toBe(true);
        press(view.host, 'Publish version 2');
        await settle(view.fixture);

        expect(view.api.publishFoundingTerms).toHaveBeenCalledWith({
          clientsWithActivePlan: 10,
          monthsSinceStart: 2,
          note: null,
          expectedCurrentVersion: 1,
          foundingSeatIncludedClients: 13,
          priceGuaranteeMonths: 5,
        });
        expect(view.closed).toEqual([PUBLISHED]);
      });

      it('publishes none when the box is emptied, sent as null, and says so in What changes', async () => {
        const view = await render(PlatformFoundingTerms, held);

        fill(view.host, MONTHS, '');
        await settle(view.fixture);
        expect(changes(view)).toEqual([[MONTHS, '5', 'None']]);
        press(view.host, 'Publish version 2');
        await settle(view.fixture);

        expect(view.api.publishFoundingTerms).toHaveBeenCalledWith({
          clientsWithActivePlan: 10,
          monthsSinceStart: 2,
          note: null,
          expectedCurrentVersion: 1,
          foundingSeatIncludedClients: 13,
          priceGuaranteeMonths: null,
        });
      });

      it('keeps the months in force when only a threshold changes', async () => {
        const view = await render(PlatformFoundingTerms, held);

        fill(view.host, 'Clients with an active plan', '12');
        await settle(view.fixture);
        expect(changes(view)).toEqual([['Clients with an active plan', '10', '12']]);
        press(view.host, 'Publish version 2');
        await settle(view.fixture);

        expect(view.api.publishFoundingTerms).toHaveBeenCalledWith({
          clientsWithActivePlan: 12,
          monthsSinceStart: 2,
          note: null,
          expectedCurrentVersion: 1,
          foundingSeatIncludedClients: 13,
          priceGuaranteeMonths: 5,
        });
      });

      it('takes them from 0 to 120 only, in the server’s words', async () => {
        const view = await render(PlatformFoundingTerms, held);

        fill(view.host, MONTHS, '121');
        await settle(view.fixture);
        expect(changes(view), 'A number that is not valid yet is no change.').toEqual([]);
        press(view.host, 'Publish version 2');
        await settle(view.fixture);

        expect(view.api.publishFoundingTerms).not.toHaveBeenCalled();
        expect(described(months(view))).toBe(RANGE);
        expect(textOf(view.host)).toContain('Check the fields marked above.');
        expect(months(view).getAttribute('aria-invalid')).toBe('true');
        expect(document.activeElement?.getAttribute('name')).toBe('priceGuaranteeMonths');

        fill(view.host, MONTHS, '-1');
        await settle(view.fixture);
        press(view.host, 'Publish version 2');
        await settle(view.fixture);
        expect(view.api.publishFoundingTerms).not.toHaveBeenCalled();
        expect(described(months(view))).toBe(RANGE);

        fill(view.host, MONTHS, '120');
        await settle(view.fixture);
        expect(textOf(view.host)).not.toContain(RANGE);
        expect(months(view).getAttribute('aria-invalid')).toBeNull();
        expect(changes(view)).toEqual([[MONTHS, '5', '120']]);

        // No months after the last discount is a number of its own, never none.
        fill(view.host, MONTHS, '0');
        await settle(view.fixture);
        expect(changes(view)).toEqual([[MONTHS, '5', '0']]);
        press(view.host, 'Publish version 2');
        await settle(view.fixture);
        expect(view.api.publishFoundingTerms).toHaveBeenCalledTimes(1);
        expect(view.api.publishFoundingTerms).toHaveBeenCalledWith(
          expect.objectContaining({ priceGuaranteeMonths: 0 }),
        );
      });

      it('marks months the browser cannot read, never publishing them as none or at their old value', async () => {
        const view = await render(PlatformFoundingTerms, held);
        const box = months(view);
        // What a browser reports for "7e" in a number box: no number, and bad input.
        const typed = (valueAsNumber: number, badInput: boolean) => {
          Object.defineProperty(box, 'valueAsNumber', {
            configurable: true,
            get: () => valueAsNumber,
          });
          Object.defineProperty(box, 'validity', { configurable: true, get: () => ({ badInput }) });
          box.dispatchEvent(new Event('input'));
        };

        // A threshold changes too, so there is something to publish: the months alone hold it back.
        fill(view.host, 'Clients with an active plan', '12');
        typed(Number.NaN, true);
        await settle(view.fixture);
        expect(changes(view)).toEqual([['Clients with an active plan', '10', '12']]);
        press(view.host, 'Publish version 2');
        await settle(view.fixture);
        expect(view.api.publishFoundingTerms).not.toHaveBeenCalled();
        expect(described(box)).toBe(RANGE);
        expect(box.getAttribute('aria-invalid')).toBe('true');
        expect(document.activeElement).toBe(box);
        // The founding seat's box beside it is not marked for it.
        expect(
          view.host
            .querySelector('input[name="foundingSeatIncludedClients"]')!
            .getAttribute('aria-invalid'),
        ).not.toBe('true');

        typed(7, false);
        await settle(view.fixture);
        expect(changes(view)).toEqual([
          ['Clients with an active plan', '10', '12'],
          [MONTHS, '5', '7'],
        ]);
        press(view.host, 'Publish version 2');
        await settle(view.fixture);
        expect(view.api.publishFoundingTerms).toHaveBeenCalledTimes(1);
        expect(view.api.publishFoundingTerms).toHaveBeenCalledWith({
          clientsWithActivePlan: 12,
          monthsSinceStart: 2,
          note: null,
          expectedCurrentVersion: 1,
          foundingSeatIncludedClients: 13,
          priceGuaranteeMonths: 7,
        });
      });
    });

    it('keeps a stale version’s refusal on screen', async () => {
      const view = await render(PlatformFoundingTerms, inputs, {
        publishFoundingTerms: vi.fn(() =>
          throwError(() =>
            refusal(
              'founding_terms_changed',
              'Newer founding badge terms were published since this page loaded. Refresh and try again.',
            ),
          ),
        ),
      });

      fill(view.host, 'Clients with an active plan', '8');
      await settle(view.fixture);
      press(view.host, 'Publish version 2');
      await settle(view.fixture);

      expect(textOf(view.host.querySelector('[role="alert"]'))).toBe(
        'Newer founding badge terms were published since this page loaded. Refresh and try again.',
      );
      expect(view.closed).toEqual([]);
    });
  });
});
