import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { of, Subject, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HouseSetting } from '../../core/api/generated';
import { CsrfService } from '../../core/security/csrf.service';
import { button, field, fill, leave, press, settle } from '../../../testing/dom';
import {
  emptyHouse,
  HOUSE_WHISH_NUMBER,
  houseAdmin,
  houseSetting,
} from '../../../testing/platform-admin-fixtures';
import { PlatformHouseApi } from './platform-house-api';
import { PlatformHouseSetting } from './platform-house-setting';
import { type HouseSettingRow, toHouseAdmin, toHouseSetting } from './platform-house.models';

type Api = { [K in keyof PlatformHouseApi]: ReturnType<typeof vi.fn> };

const HOUSE = toHouseAdmin(houseAdmin()).house!;
/** New sign-ups a week: 23 at version 3, changed by Samir Aoun on Fri 9 Oct on the house's clock. */
const PER_WEEK = toHouseSetting(houseSetting());
/** The youngest age that may sign up: 19 at version 1, changed on Thu 12 Nov. */
const AGE = toHouseSetting(houseAdmin().settings[1]);
/** New sign-ups a week as another admin left it while the sheet was open. */
const CHANGED = toHouseSetting(
  houseSetting({
    value: '31',
    version: 4,
    changedAtUtc: '2026-11-12T09:00:00Z',
    changedByName: 'Lina Saab',
  }),
);

const PER_WEEK_REASON = 'Enter a whole number from 0 to 10,000, or leave it empty.';
const AGE_REASON = 'Enter an age from 18 to 100, or leave it empty.';

/** The house's Whish number for plans: +961 70 123 456 at version 1, set on Thu 12 Nov (notes plan N9c2). */
const WHISH = toHouseSetting(
  houseSetting({
    setting: 'WhishNumber',
    value: HOUSE_WHISH_NUMBER,
    version: 1,
    changedAtUtc: '2026-11-12T08:00:00Z',
  }),
);
const WHISH_LABEL = 'Whish number for plans';
const WHISH_REASON =
  'Enter 6 to 20 digits, with a + in front if you like and spaces between groups, or leave it empty.';

async function render(
  inputs: { start?: HouseSettingRow; current?: HouseSettingRow } = {},
  overrides: Partial<Api> = {},
) {
  const start = inputs.start ?? PER_WEEK;
  const api: Api = {
    getHouse: vi.fn(),
    // The server answers with the change in force: the next version, made just now.
    changeSetting: vi.fn((setting: HouseSetting, value: string | null, version: number) =>
      of(
        toHouseSetting(
          houseSetting({
            setting,
            value,
            version: version + 1,
            changedAtUtc: '2026-11-12T10:00:00Z',
          }),
        ),
      ),
    ),
    ...overrides,
  };
  const csrf = { refresh: vi.fn(() => Promise.resolve()) };
  TestBed.configureTestingModule({
    providers: [
      { provide: PlatformHouseApi, useValue: api },
      { provide: CsrfService, useValue: csrf },
    ],
  });
  const fixture = TestBed.createComponent(PlatformHouseSetting);
  fixture.componentRef.setInput('start', start);
  fixture.componentRef.setInput('current', inputs.current ?? start);
  fixture.componentRef.setInput('house', HOUSE);
  const closed: (HouseSettingRow | null)[] = [];
  const dirty: boolean[] = [];
  let meanwhile = 0;
  fixture.componentInstance.closed.subscribe((value) => closed.push(value));
  fixture.componentInstance.dirtyChange.subscribe((value) => dirty.push(value));
  fixture.componentInstance.changedMeanwhile.subscribe(() => meanwhile++);
  await settle(fixture);
  return {
    fixture,
    host: fixture.nativeElement as HTMLElement,
    api,
    csrf,
    closed,
    dirty,
    meanwhile: () => meanwhile,
  };
}

const textOf = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

const box = (host: HTMLElement) => host.querySelector<HTMLInputElement>('input[name="value"]')!;
/** The words under the box, help or error, as the field draws them. */
const support = (host: HTMLElement) => textOf(host.querySelector('app-field .tb-field__support'));
const errorUnder = (host: HTMLElement) =>
  textOf(host.querySelector('app-field .tb-field__support--error'));

/** A refusal as the API sends it: a 409 with its code and its sentence. */
const refusal = (code: string, message: string) =>
  new HttpErrorResponse({ status: 409, error: { code, message } });

describe('Changing one of the house’s settings (notes plan N9a2)', () => {
  afterEach(() => TestBed.resetTestingModule());

  describe('what the sheet shows', () => {
    it('says what is in force now, and starts the box on it, within the setting’s bounds', async () => {
      const { host, dirty } = await render();

      expect(textOf(host.querySelector('p.notice[data-in-force]'))).toBe(
        'In force now: 23 · Changed by Samir Aoun on Fri 9 Oct',
      );
      const input = field(host, 'New sign-ups a week');
      expect(input).toBe(box(host));
      expect(input.value).toBe('23');
      expect(input.type).toBe('number');
      expect(input.getAttribute('inputmode')).toBe('numeric');
      expect(input.getAttribute('min')).toBe('0');
      expect(input.getAttribute('max')).toBe('10000');
      expect(support(host)).toBe(
        'A whole number from 0 to 10,000. Empty or 0 keeps sign-up closed.',
      );
      expect(Array.from(host.querySelectorAll('button'), (action) => textOf(action))).toEqual([
        'Not now',
        'Save',
      ]);
      expect(dirty.at(-1)).toBe(false);
    });

    it('words the youngest age as its own, with an adult’s bounds', async () => {
      const { host } = await render({ start: AGE });

      expect(textOf(host.querySelector('[data-in-force]'))).toBe(
        'In force now: 19 · Changed by Samir Aoun on Thu 12 Nov',
      );
      const input = field(host, 'Youngest age that may sign up');
      expect(input.value).toBe('19');
      expect(input.getAttribute('min')).toBe('18');
      expect(input.getAttribute('max')).toBe('100');
      expect(support(host)).toBe(
        'From 18 to 100. Empty keeps sign-up closed. TB Gym is for adults, so it can’t be under 18.',
      );
    });

    it('starts empty for a setting never set, and says so', async () => {
      const { host, dirty } = await render({ start: toHouseSetting(emptyHouse().settings[0]) });

      expect(textOf(host.querySelector('[data-in-force]'))).toBe('In force now: Empty · Never set');
      expect(box(host).value).toBe('');
      expect(dirty.at(-1)).toBe(false);
    });

    it('follows the setting as the page reads it now, keeping what was typed', async () => {
      const { fixture, host } = await render();

      fill(host, 'New sign-ups a week', '25');
      fixture.componentRef.setInput('current', CHANGED);
      await settle(fixture);

      expect(textOf(host.querySelector('[data-in-force]'))).toBe(
        'In force now: 31 · Changed by Lina Saab on Thu 12 Nov',
      );
      expect(box(host).value).toBe('25');
    });
  });

  describe('saving', () => {
    it('reads the security token, then sends what was typed at the version in force', async () => {
      const { fixture, host, api, csrf, closed, dirty } = await render();

      fill(host, 'New sign-ups a week', '25');
      await settle(fixture);
      expect(dirty.at(-1)).toBe(true);
      press(host, 'Save');
      await settle(fixture);

      expect(api.changeSetting).toHaveBeenCalledTimes(1);
      expect(api.changeSetting).toHaveBeenCalledWith('SignUpsPerWeek', '25', 3);
      expect(csrf.refresh.mock.invocationCallOrder[0]).toBeLessThan(
        api.changeSetting.mock.invocationCallOrder[0],
      );
      expect(closed).toHaveLength(1);
      expect(closed[0]).toMatchObject({ setting: 'SignUpsPerWeek', value: '25', version: 4 });
    });

    it('sends the number without the spaces around it', async () => {
      const { fixture, host, api } = await render();
      // jsdom empties a number box handed spaces; this box keeps what it is given, as `value` is read.
      const input = box(host);
      let held = ' 25 ';
      Object.defineProperty(input, 'value', {
        configurable: true,
        get: () => held,
        set: (next: string) => (held = next),
      });
      input.dispatchEvent(new Event('input'));
      await settle(fixture);
      press(host, 'Save');
      await settle(fixture);

      expect(api.changeSetting).toHaveBeenCalledWith('SignUpsPerWeek', '25', 3);
    });

    it('sends null for an emptied box, which empties the setting', async () => {
      const { fixture, host, api, closed } = await render({ start: AGE });

      fill(host, 'Youngest age that may sign up', '');
      await settle(fixture);
      press(host, 'Save');
      await settle(fixture);

      expect(api.changeSetting).toHaveBeenCalledWith('MinimumSignUpAge', null, 1);
      expect(closed[0]).toMatchObject({ setting: 'MinimumSignUpAge', value: null });
    });

    it('sends the version the page holds now, not the one the sheet opened on', async () => {
      const { fixture, host, api } = await render({ current: CHANGED });

      fill(host, 'New sign-ups a week', '25');
      await settle(fixture);
      press(host, 'Save');
      await settle(fixture);

      expect(api.changeSetting).toHaveBeenCalledWith('SignUpsPerWeek', '25', 4);
    });

    it('takes the bounds themselves and 0, which keeps sign-up closed', async () => {
      for (const [start, label, typed] of [
        [PER_WEEK, 'New sign-ups a week', '0'],
        [PER_WEEK, 'New sign-ups a week', '10000'],
        [AGE, 'Youngest age that may sign up', '18'],
        [AGE, 'Youngest age that may sign up', '100'],
      ] as const) {
        const { fixture, host, api } = await render({ start });
        fill(host, label, typed);
        await settle(fixture);
        press(host, 'Save');
        await settle(fixture);

        expect(api.changeSetting).toHaveBeenCalledWith(start.setting, typed, start.version);
        TestBed.resetTestingModule();
      }
    });

    it('says Saving… and sends once while the answer is on its way', async () => {
      const answer = new Subject<HouseSettingRow>();
      const { fixture, host, api, closed } = await render(
        {},
        { changeSetting: vi.fn(() => answer) },
      );

      fill(host, 'New sign-ups a week', '25');
      await settle(fixture);
      press(host, 'Save');
      await settle(fixture);
      const saving = button(host, 'Saving…');
      expect(saving.getAttribute('aria-disabled')).toBe('true');
      saving.click();
      await settle(fixture);
      expect(api.changeSetting).toHaveBeenCalledTimes(1);

      answer.next({ ...PER_WEEK, value: '25', version: 4 });
      answer.complete();
      await settle(fixture);
      expect(closed).toEqual([{ ...PER_WEEK, value: '25', version: 4 }]);
    });

    it('closes without saving on Not now', async () => {
      const { fixture, host, api, closed } = await render();

      fill(host, 'New sign-ups a week', '25');
      await settle(fixture);
      press(host, 'Not now');

      expect(closed).toEqual([null]);
      expect(api.changeSetting).not.toHaveBeenCalled();
    });
  });

  describe('what it refuses before sending', () => {
    it('refuses a number outside the setting’s bounds, or not a whole number, and says why under the box', async () => {
      for (const typed of ['10001', '-1', '2.5', '1e3']) {
        const { fixture, host, api, closed } = await render();

        fill(host, 'New sign-ups a week', typed);
        await settle(fixture);
        press(host, 'Save');
        await settle(fixture);

        expect(api.changeSetting).not.toHaveBeenCalled();
        expect(errorUnder(host)).toBe(PER_WEEK_REASON);
        expect(box(host).getAttribute('aria-invalid')).toBe('true');
        expect(document.activeElement).toBe(box(host));
        expect(closed).toEqual([]);
        TestBed.resetTestingModule();
      }
    });

    it('refuses an age under 18 or over 100, saying so once the box is left', async () => {
      for (const typed of ['17', '101']) {
        const { fixture, host, api } = await render({ start: AGE });

        fill(host, 'Youngest age that may sign up', typed);
        await settle(fixture);
        expect(errorUnder(host)).toBe('');
        leave(host, 'Youngest age that may sign up');
        await settle(fixture);
        expect(errorUnder(host)).toBe(AGE_REASON);

        press(host, 'Save');
        await settle(fixture);
        expect(api.changeSetting).not.toHaveBeenCalled();
        TestBed.resetTestingModule();
      }
    });

    it('sends once the number is fixed, the reason going as it is typed', async () => {
      const { fixture, host, api } = await render();

      fill(host, 'New sign-ups a week', '10001');
      await settle(fixture);
      press(host, 'Save');
      await settle(fixture);
      expect(errorUnder(host)).toBe(PER_WEEK_REASON);

      fill(host, 'New sign-ups a week', '9999');
      await settle(fixture);
      expect(errorUnder(host)).toBe('');
      expect(box(host).getAttribute('aria-invalid')).toBeNull();
      press(host, 'Save');
      await settle(fixture);
      expect(api.changeSetting).toHaveBeenCalledWith('SignUpsPerWeek', '9999', 3);
    });

    it('marks a box the browser cannot read as a number, and never sends it as empty', async () => {
      const { fixture, host, api } = await render();
      const input = box(host);
      // What a browser reports for "12e": an empty value it marks as bad input; jsdom has no such state.
      Object.defineProperty(input, 'validity', {
        configurable: true,
        get: () => ({ badInput: true }),
      });

      fill(host, 'New sign-ups a week', '');
      await settle(fixture);
      press(host, 'Save');
      await settle(fixture);

      expect(api.changeSetting).not.toHaveBeenCalled();
      expect(errorUnder(host)).toBe(PER_WEEK_REASON);
      expect(input.getAttribute('aria-invalid')).toBe('true');

      // Once the box holds a number again, it is sent.
      delete (input as { validity?: unknown }).validity;
      fill(host, 'New sign-ups a week', '27');
      await settle(fixture);
      press(host, 'Save');
      await settle(fixture);
      expect(api.changeSetting).toHaveBeenCalledWith('SignUpsPerWeek', '27', 3);
    });
  });

  describe('what the server refuses', () => {
    const SERVER_SENTENCE =
      'Enter a whole number from 0 to 10,000, or leave it empty. Empty or 0 keeps sign-up closed.';

    it('shows the server’s sentence under the box with what was typed, until the box changes', async () => {
      const { fixture, host, closed } = await render(
        {},
        {
          changeSetting: vi.fn(() =>
            throwError(
              () =>
                new HttpErrorResponse({
                  status: 400,
                  error: { title: 'One or more errors.', errors: { value: [SERVER_SENTENCE] } },
                }),
            ),
          ),
        },
      );

      // Ten digits: a whole number to the sheet, too long for the server.
      fill(host, 'New sign-ups a week', '0000000025');
      await settle(fixture);
      press(host, 'Save');
      await settle(fixture);

      expect(errorUnder(host)).toBe(SERVER_SENTENCE);
      expect(box(host).getAttribute('aria-invalid')).toBe('true');
      expect(document.activeElement).toBe(box(host));
      expect(box(host).value).toBe('0000000025');
      expect(host.querySelector('[role="alert"]')).toBeNull();
      expect(closed).toEqual([]);

      fill(host, 'New sign-ups a week', '25');
      await settle(fixture);
      expect(errorUnder(host)).toBe('');
    });

    it('reads the server’s sentence under Value too', async () => {
      const { fixture, host } = await render(
        {},
        {
          changeSetting: vi.fn(() =>
            throwError(
              () =>
                new HttpErrorResponse({
                  status: 400,
                  error: { errors: { Value: [SERVER_SENTENCE] } },
                }),
            ),
          ),
        },
      );

      fill(host, 'New sign-ups a week', '25');
      press(host, 'Save');
      await settle(fixture);

      expect(errorUnder(host)).toBe(SERVER_SENTENCE);
    });

    it('keeps what was typed when the setting changed meanwhile, and tells the page once', async () => {
      const changeSetting = vi
        .fn()
        .mockReturnValueOnce(
          throwError(() =>
            refusal(
              'house_setting_changed',
              'This setting changed since the page loaded. Refresh and try again.',
            ),
          ),
        )
        .mockReturnValueOnce(of({ ...CHANGED, value: '25', version: 5 }));
      const { fixture, host, closed, meanwhile } = await render({}, { changeSetting });

      fill(host, 'New sign-ups a week', '25');
      await settle(fixture);
      press(host, 'Save');
      await settle(fixture);

      expect(meanwhile()).toBe(1);
      expect(textOf(host.querySelector('[role="alert"]'))).toBe(
        'This setting was changed while this sheet was open. The line above shows it as it is now; save again to replace it.',
      );
      expect(box(host).value).toBe('25');
      expect(button(host, 'Save').getAttribute('aria-disabled')).toBeNull();
      expect(closed).toEqual([]);

      // The page reads the house again and hands the sheet the setting as it is now.
      fixture.componentRef.setInput('current', CHANGED);
      await settle(fixture);
      expect(textOf(host.querySelector('[data-in-force]'))).toBe(
        'In force now: 31 · Changed by Lina Saab on Thu 12 Nov',
      );
      press(host, 'Save');
      await settle(fixture);

      expect(changeSetting).toHaveBeenLastCalledWith('SignUpsPerWeek', '25', 4);
      expect(meanwhile()).toBe(1);
      expect(closed).toEqual([{ ...CHANGED, value: '25', version: 5 }]);
    });

    it('says the house is gone when no space is marked any more, and tells the page once', async () => {
      const { fixture, host, closed, meanwhile } = await render(
        {},
        {
          changeSetting: vi.fn(() =>
            throwError(() =>
              refusal(
                'house_not_set',
                'No coaching space is marked as the house yet, so it has no settings to change.',
              ),
            ),
          ),
        },
      );

      fill(host, 'New sign-ups a week', '25');
      press(host, 'Save');
      await settle(fixture);

      expect(meanwhile()).toBe(1);
      expect(textOf(host.querySelector('[role="alert"]'))).toBe(
        'No coaching space is marked as the house any more, so it has no settings to change.',
      );
      expect(box(host).value).toBe('25');
      expect(closed).toEqual([]);
    });

    it('shows any other refusal in the server’s words, and its own sentence when the server fails', async () => {
      const other = await render(
        {},
        {
          changeSetting: vi.fn(() =>
            throwError(() => refusal('something_else', 'The house is being moved. Try later.')),
          ),
        },
      );
      fill(other.host, 'New sign-ups a week', '25');
      press(other.host, 'Save');
      await settle(other.fixture);
      expect(textOf(other.host.querySelector('[role="alert"]'))).toBe(
        'The house is being moved. Try later.',
      );
      expect(other.meanwhile()).toBe(0);
      TestBed.resetTestingModule();

      const failed = await render(
        {},
        {
          changeSetting: vi.fn(() => throwError(() => new HttpErrorResponse({ status: 500 }))),
        },
      );
      fill(failed.host, 'New sign-ups a week', '25');
      press(failed.host, 'Save');
      await settle(failed.fixture);
      expect(textOf(failed.host.querySelector('[role="alert"]'))).toBe(
        'The setting couldn’t be saved. Try again.',
      );
      expect(failed.closed).toEqual([]);
      expect(failed.meanwhile()).toBe(0);
    });
  });

  describe('typed work', () => {
    it('is typed work only while the box differs from the value the sheet opened on', async () => {
      const { fixture, host, dirty } = await render();

      fill(host, 'New sign-ups a week', '25');
      await settle(fixture);
      expect(dirty.at(-1)).toBe(true);
      fill(host, 'New sign-ups a week', '23');
      await settle(fixture);
      expect(dirty.at(-1)).toBe(false);
      fill(host, 'New sign-ups a week', '');
      await settle(fixture);
      expect(dirty.at(-1)).toBe(true);
    });

    it('counts something the browser cannot read as a number as typed work, so closing asks', async () => {
      const { fixture, host, dirty } = await render();
      const input = box(host);
      Object.defineProperty(input, 'validity', {
        configurable: true,
        get: () => ({ badInput: true }),
      });

      fill(host, 'New sign-ups a week', '');
      await settle(fixture);

      expect(dirty.at(-1)).toBe(true);
    });

    it('measures against the value it opened on, not the one the page reads meanwhile', async () => {
      const { fixture, host, dirty } = await render();

      fixture.componentRef.setInput('current', CHANGED);
      await settle(fixture);
      expect(dirty.at(-1)).toBe(false);
      fill(host, 'New sign-ups a week', '31');
      await settle(fixture);
      expect(dirty.at(-1)).toBe(true);
    });

    it('counts nothing typed into a setting never set as typed work', async () => {
      const { fixture, host, dirty } = await render({
        start: toHouseSetting(emptyHouse().settings[1]),
      });

      fill(host, 'Youngest age that may sign up', '');
      await settle(fixture);
      expect(dirty.at(-1)).toBe(false);
      fill(host, 'Youngest age that may sign up', '21');
      await settle(fixture);
      expect(dirty.at(-1)).toBe(true);
    });
  });

  describe('the house’s Whish number (notes plan N9c2)', () => {
    it('edits it in a text box for a phone’s number pad, left to right, as long as the server keeps', async () => {
      const { host, dirty } = await render({ start: WHISH });

      expect(textOf(host.querySelector('[data-in-force]'))).toBe(
        'In force now: +961 70 123 456 · Changed by Samir Aoun on Thu 12 Nov',
      );
      const input = field(host, WHISH_LABEL);
      expect(input).toBe(box(host));
      expect(input.value).toBe(HOUSE_WHISH_NUMBER);
      expect(input.type).toBe('text');
      expect(input.getAttribute('inputmode')).toBe('tel');
      expect(input.getAttribute('autocomplete')).toBe('off');
      expect(input.getAttribute('dir')).toBe('ltr');
      expect(input.getAttribute('maxlength')).toBe('40');
      for (const bound of ['min', 'max', 'step']) expect(input.hasAttribute(bound)).toBe(false);
      expect(support(host)).toBe(
        'The number trainees send a plan’s money to by Whish: 6 to 20 digits, with a + in front if you like and spaces between groups. Empty keeps asks for a paid plan closed.',
      );
      expect(dirty.at(-1)).toBe(false);
    });

    it('keeps a number setting’s box a number box, with no text limit', async () => {
      const { host } = await render();

      expect(box(host).type).toBe('number');
      expect(box(host).hasAttribute('maxlength')).toBe(false);
      expect(box(host).hasAttribute('dir')).toBe(false);
    });

    it('sends a number in the server’s form, or with spaces it will make one, at the version in force', async () => {
      for (const typed of ['+961 70 123 456', '  +961   70 123456 ', '+ 961 71 234', '70123456']) {
        const { fixture, host, api, closed } = await render({ start: WHISH });

        fill(host, WHISH_LABEL, typed);
        await settle(fixture);
        press(host, 'Save');
        await settle(fixture);

        // The server keeps its one form; the page shows what it answers.
        expect(api.changeSetting).toHaveBeenCalledWith('WhishNumber', typed.trim(), 1);
        expect(errorUnder(host)).toBe('');
        expect(closed).toHaveLength(1);
        TestBed.resetTestingModule();
      }
    });

    it('refuses what the server would, and says why under the box before sending', async () => {
      const twentyInGroups = '1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0';
      for (const typed of ['70-123-456', '12345', '1'.repeat(21), `+ ${twentyInGroups}`]) {
        const { fixture, host, api, closed } = await render({ start: WHISH });

        fill(host, WHISH_LABEL, typed);
        await settle(fixture);
        press(host, 'Save');
        await settle(fixture);

        expect(api.changeSetting).not.toHaveBeenCalled();
        expect(errorUnder(host)).toBe(WHISH_REASON);
        expect(box(host).getAttribute('aria-invalid')).toBe('true');
        expect(document.activeElement).toBe(box(host));
        expect(host.querySelector('[role="alert"]')).toBeNull();
        expect(closed).toEqual([]);
        TestBed.resetTestingModule();
      }
    });

    it('says why once the box is left, and the reason goes as the number is fixed', async () => {
      const { fixture, host, api } = await render({ start: WHISH });

      fill(host, WHISH_LABEL, '70-123-456');
      await settle(fixture);
      expect(errorUnder(host)).toBe('');
      leave(host, WHISH_LABEL);
      await settle(fixture);
      expect(errorUnder(host)).toBe(WHISH_REASON);

      fill(host, WHISH_LABEL, '70 123 456');
      await settle(fixture);
      expect(errorUnder(host)).toBe('');
      press(host, 'Save');
      await settle(fixture);
      expect(api.changeSetting).toHaveBeenCalledWith('WhishNumber', '70 123 456', 1);
    });

    it('sends null for an emptied box, which closes asks for a paid plan', async () => {
      const { fixture, host, api, closed, dirty } = await render({ start: WHISH });

      fill(host, WHISH_LABEL, '   ');
      await settle(fixture);
      expect(dirty.at(-1)).toBe(true);
      press(host, 'Save');
      await settle(fixture);

      expect(api.changeSetting).toHaveBeenCalledWith('WhishNumber', null, 1);
      expect(closed[0]).toMatchObject({ setting: 'WhishNumber', value: null, version: 2 });
    });

    it('starts empty while it was never set, and fills at version 0', async () => {
      const never = toHouseSetting({ setting: 'WhishNumber', value: null, version: 0 });
      const { fixture, host, api, dirty } = await render({ start: never });

      expect(textOf(host.querySelector('[data-in-force]'))).toBe('In force now: Empty · Never set');
      expect(box(host).value).toBe('');
      fill(host, WHISH_LABEL, '+961 70 123 456');
      await settle(fixture);
      expect(dirty.at(-1)).toBe(true);
      press(host, 'Save');
      await settle(fixture);

      expect(api.changeSetting).toHaveBeenCalledWith('WhishNumber', '+961 70 123 456', 0);
    });

    it('shows the server’s sentence under the box when it refuses the number', async () => {
      const sentence =
        'Enter the Whish number trainees send money to: 6 to 20 digits, with a + in front if you like and spaces between groups. Or leave it empty, which keeps asks for a paid plan closed.';
      const { fixture, host, closed } = await render(
        { start: WHISH },
        {
          changeSetting: vi.fn(() =>
            throwError(
              () =>
                new HttpErrorResponse({
                  status: 400,
                  error: { title: 'One or more errors.', errors: { value: [sentence] } },
                }),
            ),
          ),
        },
      );

      fill(host, WHISH_LABEL, '+961 71 234 567');
      await settle(fixture);
      press(host, 'Save');
      await settle(fixture);

      expect(errorUnder(host)).toBe(sentence);
      expect(box(host).getAttribute('aria-invalid')).toBe('true');
      expect(document.activeElement).toBe(box(host));
      expect(box(host).value).toBe('+961 71 234 567');
      expect(host.querySelector('[role="alert"]')).toBeNull();
      expect(closed).toEqual([]);
    });
  });
});
