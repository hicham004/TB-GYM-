import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonths,
  addYears,
  adultCutoff,
  clampIso,
  daysInMonth,
  deviceToday,
  endOfWeek,
  isIsoDate,
  isoWeekdayOfName,
  monthStart,
  monthWeeks,
  startOfWeek,
  toDate,
  toIso,
  weekday,
} from './calendar';

describe('calendar maths', () => {
  it('knows a real day from one that only looks like a date', () => {
    expect(isIsoDate('2026-10-09')).toBe(true);
    expect(isIsoDate('2028-02-29')).toBe(true);
    expect(isIsoDate('2026-02-29')).toBe(false);
    expect(isIsoDate('2026-13-01')).toBe(false);
    expect(isIsoDate('09/10/2026')).toBe(false);
    expect(isIsoDate('')).toBe(false);
    expect(isIsoDate(null)).toBe(false);
  });

  it('moves by days across months and years without a time zone getting in the way', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    // The nights clocks change in Beirut and New York.
    expect(addDays('2026-03-28', 1)).toBe('2026-03-29');
    expect(addDays('2026-11-01', -1)).toBe('2026-10-31');
  });

  it('keeps the day of the month when it can, and else lands on the last day', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
    expect(addMonths('2026-03-31', -1)).toBe('2026-02-28');
    expect(addMonths('2026-10-09', 3)).toBe('2027-01-09');
    expect(addYears('2028-02-29', 1)).toBe('2029-02-28');
    expect(addYears('2026-10-09', -1)).toBe('2025-10-09');
  });

  it('finds the latest birth date of an adult as the server counts it, around 29 February', () => {
    expect(adultCutoff('2026-10-10')).toBe('2008-10-10');
    expect(adultCutoff('2026-03-01')).toBe('2008-03-01');
    // Born 29 February 2008, 18 on 28 February 2026: the server adds 18 years and lands on the 28th.
    expect(adultCutoff('2026-02-28')).toBe('2008-02-29');
    // Born 1 March 2010 is not 18 on 29 February 2028, but born 28 February 2010 is.
    expect(adultCutoff('2028-02-29')).toBe('2010-02-28');
    expect(adultCutoff('2028-03-01')).toBe('2010-03-01');
  });

  it('counts days in a month and finds the weekday', () => {
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(daysInMonth(2026, 12)).toBe(31);
    expect(monthStart('2026-10-09')).toBe('2026-10-01');
    // 9 October 2026 is a Friday; 11 October is a Sunday, which is 7, not 0.
    expect(weekday('2026-10-09')).toBe(5);
    expect(weekday('2026-10-11')).toBe(7);
    expect(weekday('2026-10-12')).toBe(1);
  });

  it('turns the day names the API writes into ISO weekdays', () => {
    expect(isoWeekdayOfName('Monday')).toBe(1);
    expect(isoWeekdayOfName('Sunday')).toBe(7);
    expect(isoWeekdayOfName('Someday')).toBeNull();
    expect(isoWeekdayOfName(undefined)).toBeNull();
  });

  it('finds the ends of the week for either first day', () => {
    expect(startOfWeek('2026-10-09', 1)).toBe('2026-10-05');
    expect(endOfWeek('2026-10-09', 1)).toBe('2026-10-11');
    expect(startOfWeek('2026-10-09', 7)).toBe('2026-10-04');
    expect(endOfWeek('2026-10-09', 7)).toBe('2026-10-10');
    expect(startOfWeek('2026-10-05', 1)).toBe('2026-10-05');
  });

  it('clamps a day into a range that may be open at either end', () => {
    expect(clampIso('2026-10-01', '2026-10-05', '2026-10-20')).toBe('2026-10-05');
    expect(clampIso('2026-10-25', '2026-10-05', '2026-10-20')).toBe('2026-10-20');
    expect(clampIso('2026-10-10', '2026-10-05', '2026-10-20')).toBe('2026-10-10');
    expect(clampIso('2026-10-10', null, null)).toBe('2026-10-10');
    expect(clampIso('2026-10-10', null, '2026-10-01')).toBe('2026-10-01');
  });

  it('lays a month out as six whole weeks from the first day of the week', () => {
    const october = monthWeeks('2026-10-01', 1);
    expect(october).toHaveLength(6);
    expect(october.every((week) => week.length === 7)).toBe(true);
    // 1 October 2026 is a Thursday: the first row starts on Monday 28 September.
    expect(october[0][0]).toEqual({ iso: '2026-09-28', number: 28, outside: true });
    expect(october[0][3]).toEqual({ iso: '2026-10-01', number: 1, outside: false });
    expect(october[4][5]).toEqual({ iso: '2026-10-31', number: 31, outside: false });
    expect(october[5][0].outside).toBe(true);

    const sundayFirst = monthWeeks('2026-10-01', 7);
    expect(sundayFirst[0][0].iso).toBe('2026-09-27');
    expect(sundayFirst[0][4].iso).toBe('2026-10-01');
  });

  it('round-trips a date through UTC and reads the device day', () => {
    expect(toIso(toDate('2026-10-09'))).toBe('2026-10-09');
    expect(toIso(toDate('0999-01-02'))).toBe('0999-01-02');
    expect(deviceToday(new Date(2026, 9, 9, 23, 59))).toBe('2026-10-09');
    expect(deviceToday(new Date(2026, 9, 9, 0, 1))).toBe('2026-10-09');
  });
});
