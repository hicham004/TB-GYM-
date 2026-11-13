import { describe, expect, it } from 'vitest';
import {
  emptyHouse,
  HOUSE_ID,
  HOUSE_NAME,
  houseAdmin,
  houseSetting,
  noHouse,
} from '../../../testing/platform-admin-fixtures';
import {
  changedLine,
  type HouseSignUp,
  type HouseWorkspace,
  houseSettingWords,
  houseZoneLabel,
  placesContext,
  settingValueText,
  signUpLine,
  signUpPill,
  toHouseAdmin,
  toHouseSetting,
  weekRange,
} from './platform-house.models';

const LOCALE = 'en-LB';

/** The house as the page holds it: TB Gym's own space on Beirut's clock, on Thu 12 Nov 2026. */
const BEIRUT: HouseWorkspace = {
  tenantId: HOUSE_ID,
  name: HOUSE_NAME,
  timeZoneId: 'Asia/Beirut',
  currentDate: '2026-11-12',
};

/** This week's sign-up: Monday 9 to Sunday 15 November, open, 8 places taken and 3 waiting. */
const week = (overrides: Partial<HouseSignUp> = {}): HouseSignUp => ({
  status: 'Open',
  weekStartsOn: '2026-11-09',
  weekEndsOnExclusive: '2026-11-16',
  signUpsThisWeek: 8,
  waitingForConfirmation: 3,
  ...overrides,
});

describe('The house as the platform admin reads it (notes plan N9a2)', () => {
  describe('read from the API', () => {
    it('keeps the house, its settings in the server’s order and this week’s sign-up', () => {
      expect(toHouseAdmin(houseAdmin())).toEqual({
        house: BEIRUT,
        settings: [
          {
            setting: 'SignUpsPerWeek',
            value: '23',
            version: 3,
            changedAtUtc: '2026-10-08T21:30:00Z',
            changedByName: 'Samir Aoun',
          },
          {
            setting: 'MinimumSignUpAge',
            value: '19',
            version: 1,
            changedAtUtc: '2026-11-12T07:15:00Z',
            changedByName: 'Samir Aoun',
          },
        ],
        signUp: week(),
      });
    });

    it('reads the numbers the API may send as text as numbers', () => {
      const read = toHouseAdmin(
        houseAdmin({
          settings: [houseSetting({ version: '12' })],
          signUp: { ...houseAdmin().signUp!, signUpsThisWeek: '8', waitingForConfirmation: '0' },
        }),
      );

      expect(read.settings[0].version).toBe(12);
      expect(read.signUp).toEqual(week({ waitingForConfirmation: 0 }));
    });

    it('reads a setting never changed as empty at version 0, with no day and no name', () => {
      expect(toHouseSetting({ setting: 'MinimumSignUpAge', value: null, version: 0 })).toEqual({
        setting: 'MinimumSignUpAge',
        value: null,
        version: 0,
        changedAtUtc: null,
        changedByName: null,
      });
      expect(
        toHouseAdmin(emptyHouse()).settings.map((row) => [row.setting, row.value, row.version]),
      ).toEqual([
        ['SignUpsPerWeek', null, 0],
        ['MinimumSignUpAge', null, 0],
      ]);
    });

    it('has no house, no settings and no sign-up while no space is marked', () => {
      expect(toHouseAdmin(noHouse())).toEqual({ house: null, settings: [], signUp: null });
    });
  });

  describe('each setting’s words', () => {
    it('has words for every setting the API names, with the server’s own bounds (CLI-023)', () => {
      const words = houseSettingWords();

      expect(Object.keys(words).sort()).toEqual([
        'FreeProgressDays',
        'MediaStorageGigabytes',
        'MinimumSignUpAge',
        'SignUpsPerWeek',
      ]);
      expect(words.SignUpsPerWeek).toEqual({
        label: 'New sign-ups a week',
        inSentence: 'new sign-ups a week',
        help: 'A whole number from 0 to 10,000. Empty or 0 keeps sign-up closed.',
        reason: 'Enter a whole number from 0 to 10,000, or leave it empty.',
        min: 0,
        max: 10_000,
        unit: 'count',
      });
      expect(words.MinimumSignUpAge).toEqual({
        label: 'Youngest age that may sign up',
        inSentence: 'the youngest age that may sign up',
        help: 'From 18 to 100. Empty keeps sign-up closed. TB Gym is for adults, so it can’t be under 18.',
        reason: 'Enter an age from 18 to 100, or leave it empty.',
        min: 18,
        max: 100,
        unit: 'count',
      });
      // Notes plan N9b5: Free's window in days, empty meaning no limit, and the house's storage in gigabytes.
      expect(words.FreeProgressDays).toEqual({
        label: 'How far back Free’s Progress reaches',
        inSentence: 'how far back Free’s Progress reaches',
        help: 'Days, from 1 to 3,650. Empty means no limit. Everything a trainee logs is kept, and a paid plan shows all of it.',
        reason: 'Enter a whole number of days from 1 to 3,650, or leave it empty.',
        min: 1,
        max: 3_650,
        unit: 'days',
      });
      expect(words.MediaStorageGigabytes).toEqual({
        label: 'The house’s media storage',
        inSentence: 'the house’s media storage',
        help: 'Whole gigabytes, from 1 to 10,240. Empty gives the house the platform’s allowance, the same as every coaching space’s.',
        reason: 'Enter a whole number of gigabytes from 1 to 10,240, or leave it empty.',
        min: 1,
        max: 10_240,
        unit: 'gigabytes',
      });
    });

    it('shows a value as a number, and an empty one as Empty', () => {
      expect(settingValueText('23', LOCALE)).toBe('23');
      expect(settingValueText('0', LOCALE)).toBe('0');
      expect(settingValueText('10000', LOCALE)).toBe('10,000');
      expect(settingValueText(null, LOCALE)).toBe('Empty');
      expect(settingValueText('', LOCALE)).toBe('Empty');
      expect(settingValueText('   ', LOCALE)).toBe('Empty');
      // Something that is not a number is shown as the server keeps it, never as 0.
      expect(settingValueText('soon', LOCALE)).toBe('soon');
    });

    it('names a number of days or gigabytes with its unit, and an empty one as Empty (N9b5)', () => {
      expect(settingValueText('90', LOCALE, 'days')).toBe('90 days');
      expect(settingValueText('1', LOCALE, 'days')).toBe('1 day');
      expect(settingValueText('3650', LOCALE, 'days')).toBe('3,650 days');
      expect(settingValueText('50', LOCALE, 'gigabytes')).toBe('50 GB');
      expect(settingValueText('10240', LOCALE, 'gigabytes')).toBe('10,240 GB');
      expect(settingValueText(null, LOCALE, 'days')).toBe('Empty');
      expect(settingValueText('', LOCALE, 'gigabytes')).toBe('Empty');
      expect(settingValueText('23', LOCALE, 'count')).toBe('23');
    });
  });

  describe('who changed a setting, and when', () => {
    const row = toHouseSetting(houseSetting());

    it('names who changed it and the day, on the house’s clock', () => {
      // 21:30 UTC on Thu 8 Oct is already 00:30 on Fri 9 Oct in Beirut.
      expect(changedLine(row, BEIRUT, LOCALE)).toBe('Changed by Samir Aoun on Fri 9 Oct');
    });

    it('reads the day on the house’s clock wherever the device is', () => {
      const on = (timeZoneId: string) => changedLine(row, { ...BEIRUT, timeZoneId }, LOCALE);

      // Two clocks a day apart for the same moment, so one of them is never the device's.
      expect(on('Pacific/Kiritimati')).toBe('Changed by Samir Aoun on Fri 9 Oct');
      expect(on('America/Los_Angeles')).toBe('Changed by Samir Aoun on Thu 8 Oct');
      expect(on('UTC')).toBe('Changed by Samir Aoun on Thu 8 Oct');
    });

    it('gives the year only for a day outside the house’s current year, on its clock', () => {
      const at = (changedAtUtc: string) => changedLine({ ...row, changedAtUtc }, BEIRUT, LOCALE);

      expect(at('2025-12-30T10:00:00Z')).toBe('Changed by Samir Aoun on 30 Dec 2025');
      // 22:30 UTC on 31 December 2025 is past midnight in Beirut: the house's new year.
      expect(at('2025-12-31T22:30:00Z')).toBe('Changed by Samir Aoun on Thu 1 Jan');
      expect(
        changedLine(
          { ...row, changedAtUtc: '2025-12-31T22:30:00Z' },
          { ...BEIRUT, timeZoneId: 'UTC' },
          LOCALE,
        ),
      ).toBe('Changed by Samir Aoun on 31 Dec 2025');
    });

    it('names no one when the server sends no name', () => {
      expect(changedLine({ ...row, changedByName: null }, BEIRUT, LOCALE)).toBe(
        'Changed on Fri 9 Oct',
      );
      expect(changedLine({ ...row, changedByName: '' }, BEIRUT, LOCALE)).toBe(
        'Changed on Fri 9 Oct',
      );
    });

    it('says Never set for a setting no one has changed', () => {
      expect(changedLine(toHouseSetting(emptyHouse().settings[0]), BEIRUT, LOCALE)).toBe(
        'Never set',
      );
      expect(changedLine({ ...row, changedAtUtc: null }, BEIRUT, LOCALE)).toBe('Never set');
    });
  });

  describe('the house’s week and clock', () => {
    it('names the week from its first day to its last, the end being exclusive', () => {
      expect(weekRange(week(), LOCALE)).toBe('Mon 9 Nov – Sun 15 Nov');
      expect(
        weekRange(week({ weekStartsOn: '2026-12-28', weekEndsOnExclusive: '2027-01-04' }), LOCALE),
      ).toBe('Mon 28 Dec – Sun 3 Jan');
      // A house whose week starts on Saturday.
      expect(
        weekRange(week({ weekStartsOn: '2026-11-07', weekEndsOnExclusive: '2026-11-14' }), LOCALE),
      ).toBe('Sat 7 Nov – Fri 13 Nov');
    });

    it('names the clock by its city and area, as Settings › Name and region does', () => {
      expect(houseZoneLabel(BEIRUT, LOCALE)).toBe('Beirut, Asia');
      expect(
        houseZoneLabel({ ...BEIRUT, timeZoneId: 'America/Argentina/Buenos_Aires' }, LOCALE),
      ).toBe('Buenos Aires, America');
      expect(houseZoneLabel({ ...BEIRUT, timeZoneId: 'UTC' }, LOCALE)).toBe('UTC');
    });
  });

  describe('where sign-up stands this week', () => {
    it('draws the server’s answer as a pill: Open, Full this week or Closed', () => {
      expect(signUpPill('Open')).toEqual({ label: 'Open', tone: 'success' });
      expect(signUpPill('Full')).toEqual({ label: 'Full this week', tone: 'warning' });
      expect(signUpPill('Closed')).toEqual({ label: 'Closed', tone: 'neutral' });
    });

    it('says what the answer means in one sentence, with the day a full week opens again', () => {
      expect(signUpLine(week(), LOCALE)).toBe(
        'People can sign up on the Train with TB Gym page now.',
      );
      expect(signUpLine(week({ status: 'Full' }), LOCALE)).toBe(
        'This week’s places are taken. Sign-up opens again on Monday.',
      );
      expect(
        signUpLine(
          week({ status: 'Full', weekStartsOn: '2026-11-07', weekEndsOnExclusive: '2026-11-14' }),
          LOCALE,
        ),
      ).toBe('This week’s places are taken. Sign-up opens again on Saturday.');
      expect(signUpLine(week({ status: 'Closed' }), LOCALE)).toBe(
        'Sign-up opens once new sign-ups a week is above 0 and the youngest age is filled.',
      );
    });

    it('says how many places the week has under Places taken, only while there are some', () => {
      expect(placesContext('23', LOCALE)).toBe('of 23 this week');
      expect(placesContext('10000', LOCALE)).toBe('of 10,000 this week');
      expect(placesContext('0', LOCALE)).toBe('this week');
      expect(placesContext('', LOCALE)).toBe('this week');
      expect(placesContext(null, LOCALE)).toBe('this week');
    });
  });
});
