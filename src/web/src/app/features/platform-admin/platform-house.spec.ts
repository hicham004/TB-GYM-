import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { firstValueFrom, of, Subject, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HouseAdminView, HouseSetting } from '../../core/api/generated';
import { CsrfService } from '../../core/security/csrf.service';
import { fill, press, query, settle } from '../../../testing/dom';
import {
  emptyHouse,
  HOUSE_ID,
  HOUSE_NAME,
  houseAdmin,
  houseSetting,
  noHouse,
} from '../../../testing/platform-admin-fixtures';
import { PlatformHouse } from './platform-house';
import { PlatformHouseApi } from './platform-house-api';
import { type HouseAdmin, toHouseAdmin, toHouseSetting } from './platform-house.models';

type Api = { [K in keyof PlatformHouseApi]: ReturnType<typeof vi.fn> };

/** The house after another admin set new sign-ups a week to 31 while a sheet was open. */
const changedMeanwhile = (): HouseAdminView => {
  const house = houseAdmin();
  return {
    ...house,
    settings: [
      houseSetting({
        value: '31',
        version: 4,
        changedAtUtc: '2026-11-12T09:00:00Z',
        changedByName: 'Lina Saab',
      }),
      house.settings[1],
    ],
  };
};

async function render(overrides: Partial<Api> = {}, view: () => HouseAdminView = houseAdmin) {
  const api: Api = {
    getHouse: vi.fn(() => of(toHouseAdmin(view()))),
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
    imports: [PlatformHouse],
    providers: [
      provideRouter([]),
      { provide: PlatformHouseApi, useValue: api },
      { provide: CsrfService, useValue: csrf },
    ],
  });
  const fixture = TestBed.createComponent(PlatformHouse);
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

/** The pill's tone, read from the class it draws with; neutral draws with none. */
const toneOf = (pill: Element | null) =>
  ['success', 'warning', 'danger', 'info', 'warm'].find((tone) => pill?.classList.contains(tone)) ??
  'neutral';

/** Each setting's row as it reads: its label, its value, who changed it, and its Change's name. */
const settingRows = (host: HTMLElement) =>
  Array.from(host.querySelectorAll<HTMLElement>('[data-settings] li[data-setting]'), (row) => [
    row.dataset['setting'],
    textOf(row.querySelector('strong')),
    textOf(row.querySelector('[data-value]')),
    textOf(row.querySelector('[data-changed]')),
    textOf(row.querySelector('button[data-change]')),
  ]);

async function openChange(
  fixture: Awaited<ReturnType<typeof render>>['fixture'],
  host: HTMLElement,
  setting: HouseSetting,
): Promise<HTMLElement> {
  query<HTMLButtonElement>(host, `li[data-setting="${setting}"] button[data-change]`).click();
  await settle(fixture);
  return top()!;
}

describe('House, the platform admin’s page (notes plan N9a2)', () => {
  afterEach(() => {
    document.body.querySelectorAll('.cdk-overlay-container').forEach((node) => node.remove());
    TestBed.resetTestingModule();
  });

  describe('the page', () => {
    it('heads the page and shows the house: its space, its clock and the day its week starts', async () => {
      const { host, api } = await render();

      expect(document.activeElement).toBe(host.querySelector('h1'));
      expect(textOf(host.querySelector('h1'))).toBe('House');
      expect(textOf(host.querySelector('.lede'))).toBe(
        'TB Gym’s own coaching space, where people with no coach sign up to train with TB Gym. Each setting starts empty, and sign-up stays closed until they are filled.',
      );
      expect(host.querySelector('a[data-back]')?.getAttribute('href')).toBe('/admin/billing');
      expect(textOf(host.querySelector('a[data-back]'))).toBe('Platform billing');
      const house = query<HTMLElement>(host, '[data-house]');
      expect(textOf(house.querySelector('h2'))).toBe('The house');
      expect(
        Array.from(house.querySelectorAll('dl > div'), (term) => [
          textOf(term.querySelector('dt')),
          textOf(term.querySelector('dd')),
        ]),
      ).toEqual([
        ['Coaching space', HOUSE_NAME],
        ['Clock', 'Beirut, Asia'],
        ['Week starts on', 'Monday'],
      ]);
      const space = query<HTMLAnchorElement>(house, 'a.space-link');
      expect(space.getAttribute('href')).toBe(`/admin/billing/${HOUSE_ID}`);
      expect(textOf(space.querySelector('bdi'))).toBe(HOUSE_NAME);
      expect(textOf(house.querySelector('p.quiet'))).toBe(
        'Training days and each week’s sign-ups follow this clock.',
      );
      expect(api.getHouse).toHaveBeenCalledTimes(1);
    });

    it('shows where sign-up stands this week: its days, the server’s answer and the two counts', async () => {
      const { host } = await render();

      const signUp = query<HTMLElement>(host, '[data-sign-up]');
      expect(textOf(signUp.querySelector('h2'))).toBe('Sign-up this week');
      expect(textOf(signUp.querySelector('.panel-head .quiet'))).toBe('Mon 9 Nov – Sun 15 Nov');
      const pill = signUp.querySelector('app-status-pill');
      expect(textOf(pill)).toBe('Open');
      expect(toneOf(pill)).toBe('success');
      expect(textOf(signUp.querySelector('[data-sign-up-line]'))).toBe(
        'People can sign up on the Train with TB Gym page now.',
      );
      expect(
        Array.from(signUp.querySelectorAll('app-stat-tile'), (tile) =>
          ['.label', '.value', '.context'].map((part) => textOf(tile.querySelector(part))),
        ),
      ).toEqual([
        ['Places taken', '8', 'of 23 this week'],
        ['Waiting', '3', 'Email not confirmed yet, or confirmed into a full week'],
      ]);
    });

    it('lists each setting with its value, who changed it on the house’s clock, and a Change named for it', async () => {
      const { host } = await render();

      expect(textOf(host.querySelector('[data-settings] h2'))).toBe('Settings');
      expect(settingRows(host)).toEqual([
        [
          'SignUpsPerWeek',
          'New sign-ups a week',
          '23',
          // 21:30 UTC on Thu 8 Oct is already Fri 9 Oct in Beirut.
          'Changed by Samir Aoun on Fri 9 Oct',
          'Change new sign-ups a week',
        ],
        [
          'MinimumSignUpAge',
          'Youngest age that may sign up',
          '19',
          'Changed by Samir Aoun on Thu 12 Nov',
          'Change the youngest age that may sign up',
        ],
      ]);
      // On screen the button says Change; the rest of its name is for a screen reader.
      const change = query<HTMLButtonElement>(host, 'li[data-setting] button[data-change]');
      expect(textOf(change.querySelector('.tb-visually-hidden'))).toBe('new sign-ups a week');
      expect(host.querySelector('[data-value].empty')).toBeNull();
    });

    it('reads the day of a change on the house’s clock, whatever the device’s', async () => {
      const inUtc = () => ({
        ...houseAdmin(),
        house: { ...houseAdmin().house!, timeZoneId: 'UTC' },
      });
      const { host } = await render({}, inUtc);

      expect(textOf(host.querySelector('[data-house] dl > div:nth-child(2) dd'))).toBe('UTC');
      expect(textOf(host.querySelector('li[data-setting="SignUpsPerWeek"] [data-changed]'))).toBe(
        'Changed by Samir Aoun on Thu 8 Oct',
      );
    });

    it('says Never set and Empty for settings no one has filled, and that sign-up is closed', async () => {
      const { host } = await render({}, emptyHouse);

      expect(settingRows(host).map(([, , value, changed]) => [value, changed])).toEqual([
        ['Empty', 'Never set'],
        ['Empty', 'Never set'],
      ]);
      expect(host.querySelectorAll('[data-value].empty')).toHaveLength(2);
      const pill = host.querySelector('[data-sign-up] app-status-pill');
      expect(textOf(pill)).toBe('Closed');
      expect(toneOf(pill)).toBe('neutral');
      expect(textOf(host.querySelector('[data-sign-up-line]'))).toBe(
        'Sign-up opens once new sign-ups a week is above 0 and the youngest age is filled.',
      );
      expect(textOf(host.querySelector('app-stat-tile .context'))).toBe('this week');
    });

    it('says when a full week’s sign-up opens again', async () => {
      const full = () => {
        const house = houseAdmin();
        return {
          ...house,
          signUp: { ...house.signUp!, status: 'Full' as const, signUpsThisWeek: 23 },
        };
      };
      const { host } = await render({}, full);

      const pill = host.querySelector('[data-sign-up] app-status-pill');
      expect(textOf(pill)).toBe('Full this week');
      expect(toneOf(pill)).toBe('warning');
      expect(textOf(host.querySelector('[data-sign-up-line]'))).toBe(
        'This week’s places are taken. Sign-up opens again on Monday.',
      );
      expect(textOf(host.querySelector('app-stat-tile .value'))).toBe('23');
    });

    it('names the server command that marks a space as the house while none is', async () => {
      const { host } = await render({}, noHouse);

      const none = query<HTMLElement>(host, '[data-no-house]');
      expect(textOf(none.querySelector('h2'))).toBe('No coaching space is marked as the house');
      expect(textOf(none.querySelector('p.quiet'))).toBe(
        'Sign-up stays closed until one is. Mark one on the server with this command; its settings then appear here, each empty.',
      );
      const command = query<HTMLElement>(none, 'code.command');
      expect(command.textContent).toBe('platform-admin house set <slug or id>');
      expect(command.getAttribute('dir')).toBe('ltr');
      expect(command.getAttribute('translate')).toBe('no');
      expect(host.querySelector('[data-house], [data-sign-up], [data-settings]')).toBeNull();
      expect(host.querySelector('button[data-change]')).toBeNull();
      expect(host.querySelector('[role="alert"]')).toBeNull();
    });

    it('shows the house being read, then the house', async () => {
      const answer = new Subject<HouseAdmin>();
      const { fixture, host } = await render({ getHouse: vi.fn(() => answer) });

      const panel = query<HTMLElement>(host, '.panel[aria-busy="true"]');
      expect(textOf(panel.querySelector('app-skeleton'))).toBe('Loading the house…');
      expect(host.querySelector('[data-house], [data-no-house], [role="alert"]')).toBeNull();

      answer.next(toHouseAdmin(houseAdmin()));
      answer.complete();
      await settle(fixture);
      expect(host.querySelector('[aria-busy="true"]')).toBeNull();
      expect(host.querySelector('[data-house]')).not.toBeNull();
    });

    it('says so when the house cannot be read, and tries again', async () => {
      let failing = true;
      const { fixture, host, api } = await render({
        getHouse: vi.fn(() =>
          failing
            ? throwError(() => new HttpErrorResponse({ status: 500 }))
            : of(toHouseAdmin(houseAdmin())),
        ),
      });

      expect(textOf(host.querySelector('[role="alert"]'))).toBe('The house couldn’t be loaded.');
      expect(host.querySelector('[data-house], [data-no-house]')).toBeNull();

      failing = false;
      press(host, 'Try again');
      await settle(fixture);

      expect(api.getHouse).toHaveBeenCalledTimes(2);
      expect(host.querySelector('[role="alert"]')).toBeNull();
      expect(host.querySelector('[data-house]')).not.toBeNull();
    });
  });

  describe('changing a setting', () => {
    it('opens its sheet from Change, saves at the version read, then says so and reads the house again', async () => {
      const { fixture, host, api, csrf } = await render();

      const sheet = await openChange(fixture, host, 'SignUpsPerWeek');
      expect(titleOf(sheet)).toBe('Change new sign-ups a week');
      expect(textOf(sheet.querySelector('[data-in-force]'))).toBe(
        'In force now: 23 · Changed by Samir Aoun on Fri 9 Oct',
      );
      expect(query<HTMLInputElement>(sheet, 'input[name="value"]').value).toBe('23');

      fill(sheet, 'New sign-ups a week', '25');
      await settle(fixture);
      press(sheet, 'Save');
      await settle(fixture);

      expect(api.changeSetting).toHaveBeenCalledWith('SignUpsPerWeek', '25', 3);
      expect(csrf.refresh.mock.invocationCallOrder[0]).toBeLessThan(
        api.changeSetting.mock.invocationCallOrder[0],
      );
      expect(overlays()).toEqual([]);
      expect(toast()).toContain('New sign-ups a week is now 25.');
      expect(api.getHouse).toHaveBeenCalledTimes(2);
    });

    it('says sign-up is closed when a setting is emptied', async () => {
      const { fixture, host, api } = await render();

      const sheet = await openChange(fixture, host, 'MinimumSignUpAge');
      expect(titleOf(sheet)).toBe('Change the youngest age that may sign up');
      fill(sheet, 'Youngest age that may sign up', '');
      await settle(fixture);
      press(sheet, 'Save');
      await settle(fixture);

      expect(api.changeSetting).toHaveBeenCalledWith('MinimumSignUpAge', null, 1);
      expect(overlays()).toEqual([]);
      expect(toast()).toContain(
        'Youngest age that may sign up is now empty, so sign-up is closed.',
      );
    });

    it('says sign-up is closed when new sign-ups a week is set to 0', async () => {
      const { fixture, host } = await render();

      const sheet = await openChange(fixture, host, 'SignUpsPerWeek');
      fill(sheet, 'New sign-ups a week', '0');
      await settle(fixture);
      press(sheet, 'Save');
      await settle(fixture);

      expect(toast()).toContain('New sign-ups a week is now 0, so sign-up is closed.');
    });

    it('shows the saved value at once, even when the house cannot be read again after it', async () => {
      const { fixture, host, api } = await render();
      const sheet = await openChange(fixture, host, 'SignUpsPerWeek');
      api.getHouse.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 500 })));
      fill(sheet, 'New sign-ups a week', '29');
      await settle(fixture);
      press(sheet, 'Save');
      await settle(fixture);

      expect(toast()).toContain('New sign-ups a week is now 29.');
      expect(textOf(query(host, 'li[data-setting="SignUpsPerWeek"] [data-value]'))).toBe('29');
      expect(host.querySelector('[role="alert"]')).toBeNull();
    });

    it('closes at once with nothing typed, and asks first with typed work', async () => {
      const { fixture, host, api } = await render();

      let sheet = await openChange(fixture, host, 'SignUpsPerWeek');
      press(sheet, 'Not now');
      await settle(fixture);
      expect(overlays()).toEqual([]);

      sheet = await openChange(fixture, host, 'SignUpsPerWeek');
      fill(sheet, 'New sign-ups a week', '31');
      await settle(fixture);
      press(sheet, 'Not now');
      await settle(fixture);
      expect(titleOf(top())).toBe('Discard this change?');
      expect(textOf(top())).toContain('Close without saving? What you typed will be lost.');
      press(top()!, 'Keep editing');
      await settle(fixture);
      expect(top()).toBe(sheet);
      expect(query<HTMLInputElement>(sheet, 'input[name="value"]').value).toBe('31');

      query<HTMLButtonElement>(sheet, 'button[aria-label="Close"]').click();
      await settle(fixture);
      expect(titleOf(top())).toBe('Discard this change?');
      press(top()!, 'Discard');
      await settle(fixture);
      expect(overlays()).toEqual([]);
      expect(api.changeSetting).not.toHaveBeenCalled();
      expect(toast()).toBe('');
    });

    it('keeps the page on screen when the house cannot be read again after a sheet', async () => {
      const { fixture, host, api } = await render();
      api.getHouse.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 500 })));

      const sheet = await openChange(fixture, host, 'SignUpsPerWeek');
      press(sheet, 'Not now');
      await settle(fixture);

      expect(api.getHouse).toHaveBeenCalledTimes(2);
      expect(host.querySelector('[role="alert"]')).toBeNull();
      expect(settingRows(host)).toHaveLength(2);
    });

    it('reads the house again when the setting changed meanwhile, and saves over it at the version now read', async () => {
      const changeSetting = vi
        .fn()
        .mockReturnValueOnce(
          throwError(
            () =>
              new HttpErrorResponse({
                status: 409,
                error: {
                  code: 'house_setting_changed',
                  message: 'This setting changed since the page loaded. Refresh and try again.',
                },
              }),
          ),
        )
        .mockReturnValueOnce(of(toHouseSetting(houseSetting({ value: '25', version: 5 }))));
      const { fixture, host, api } = await render({ changeSetting });
      api.getHouse.mockReturnValue(of(toHouseAdmin(changedMeanwhile())));

      const sheet = await openChange(fixture, host, 'SignUpsPerWeek');
      fill(sheet, 'New sign-ups a week', '25');
      await settle(fixture);
      press(sheet, 'Save');
      await settle(fixture);

      expect(api.getHouse).toHaveBeenCalledTimes(2);
      expect(textOf(sheet.querySelector('[role="alert"]'))).toBe(
        'This setting was changed while this sheet was open. The line above shows it as it is now; save again to replace it.',
      );
      expect(textOf(sheet.querySelector('[data-in-force]'))).toBe(
        'In force now: 31 · Changed by Lina Saab on Thu 12 Nov',
      );
      expect(query<HTMLInputElement>(sheet, 'input[name="value"]').value).toBe('25');
      expect(textOf(host.querySelector('li[data-setting="SignUpsPerWeek"] [data-value]'))).toBe(
        '31',
      );
      expect(overlays()).toEqual([sheet]);

      press(sheet, 'Save');
      await settle(fixture);

      expect(changeSetting).toHaveBeenLastCalledWith('SignUpsPerWeek', '25', 4);
      expect(overlays()).toEqual([]);
      expect(toast()).toContain('New sign-ups a week is now 25.');
      expect(api.getHouse).toHaveBeenCalledTimes(3);
    });

    it('keeps the sheet and its answer when the house was unmarked meanwhile, the page saying none is marked', async () => {
      const { fixture, host, api } = await render({
        changeSetting: vi.fn(() =>
          throwError(
            () =>
              new HttpErrorResponse({
                status: 409,
                error: {
                  code: 'house_not_set',
                  message:
                    'No coaching space is marked as the house yet, so it has no settings to change.',
                },
              }),
          ),
        ),
      });
      api.getHouse.mockReturnValue(of(toHouseAdmin(noHouse())));

      const sheet = await openChange(fixture, host, 'SignUpsPerWeek');
      fill(sheet, 'New sign-ups a week', '25');
      await settle(fixture);
      press(sheet, 'Save');
      await settle(fixture);

      expect(overlays()).toEqual([sheet]);
      expect(textOf(sheet.querySelector('[role="alert"]'))).toBe(
        'No coaching space is marked as the house any more, so it has no settings to change.',
      );
      // The sheet still says what it opened on; the page behind it says no space is marked.
      expect(textOf(sheet.querySelector('[data-in-force]'))).toBe(
        'In force now: 23 · Changed by Samir Aoun on Fri 9 Oct',
      );
      expect(query<HTMLInputElement>(sheet, 'input[name="value"]').value).toBe('25');
      expect(host.querySelector('[data-no-house]')).not.toBeNull();
      expect(host.querySelector('[data-settings]')).toBeNull();
    });
  });
});

describe('PlatformHouseApi (notes plan N9a2)', () => {
  afterEach(() => {
    TestBed.inject(HttpTestingController).verify();
    TestBed.resetTestingModule();
  });

  function setUp() {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    return { api: TestBed.inject(PlatformHouseApi), http: TestBed.inject(HttpTestingController) };
  }

  it('reads the house from the platform admin’s address, its numbers as numbers', async () => {
    const { api, http } = setUp();

    const read = firstValueFrom(api.getHouse());
    const request = http.expectOne('/api/platform-admin/house');
    expect(request.request.method).toBe('GET');
    request.flush(
      houseAdmin({
        settings: [houseSetting({ version: '3' })],
        signUp: { ...houseAdmin().signUp!, signUpsThisWeek: '8', waitingForConfirmation: '3' },
      }),
    );

    const house = await read;
    expect(house.house?.timeZoneId).toBe('Asia/Beirut');
    expect(house.settings[0].version).toBe(3);
    expect(house.signUp?.signUpsThisWeek).toBe(8);
    expect(house.signUp?.waitingForConfirmation).toBe(3);
  });

  it('puts one setting at the version read, with null to empty it', async () => {
    const { api, http } = setUp();

    const saved = firstValueFrom(api.changeSetting('SignUpsPerWeek', '25', 3));
    const request = http.expectOne('/api/platform-admin/house/settings/SignUpsPerWeek');
    expect(request.request.method).toBe('PUT');
    expect(request.request.body).toEqual({ value: '25', expectedVersion: 3 });
    request.flush(houseSetting({ value: '25', version: '4' }));
    expect(await saved).toMatchObject({ setting: 'SignUpsPerWeek', value: '25', version: 4 });

    const emptied = firstValueFrom(api.changeSetting('MinimumSignUpAge', null, 1));
    const empty = http.expectOne('/api/platform-admin/house/settings/MinimumSignUpAge');
    expect(empty.request.body).toEqual({ value: null, expectedVersion: 1 });
    empty.flush(houseSetting({ setting: 'MinimumSignUpAge', value: null, version: 2 }));
    expect((await emptied).value).toBeNull();
  });
});
