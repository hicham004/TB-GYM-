import { describe, expect, it } from 'vitest';
import { dayInZone, houseDay, houseMoment } from './house-dates';

describe('dates as TB Gym writes them (audit COACH-6)', () => {
  it('writes a day of this year with its weekday, and another year with its year', () => {
    expect(houseDay('2026-10-25', 'en-US', '2026-10-20')).toBe('Sun 25 Oct');
    expect(houseDay('1994-03-14', 'en-US', '2026-10-20')).toBe('14 Mar 1994');
    expect(houseDay('2027-01-04', 'en-US', '2026-12-30')).toBe('4 Jan 2027');
  });

  it('takes the day an instant falls on in the workspace, not in UTC or on the device', () => {
    // 22:30 UTC is already the next day in Beirut, and still the same day in New York.
    expect(dayInZone('2026-10-14T22:30:00Z', 'Asia/Beirut')).toBe('2026-10-15');
    expect(dayInZone('2026-10-14T22:30:00Z', 'UTC')).toBe('2026-10-14');
    expect(dayInZone('2026-10-14T22:30:00Z', 'America/New_York')).toBe('2026-10-14');
    // After Beirut's clocks go back on 25 October, midnight UTC is 02:00 there, not 03:00.
    expect(dayInZone('2026-10-25T21:30:00Z', 'Asia/Beirut')).toBe('2026-10-25');
    expect(dayInZone(new Date('2026-10-26T00:30:00Z'), 'Asia/Beirut')).toBe('2026-10-26');
  });

  it('reads a zone this browser does not know on the device’s clock rather than breaking the page', () => {
    const device = new Intl.DateTimeFormat('en-CA', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date('2026-10-14T22:30:00Z'));
    expect(dayInZone('2026-10-14T22:30:00Z', 'Middle East Standard Time')).toBe(device);
    expect(houseMoment('2026-10-14T22:30:00Z', 'en-US', 'Not/A_Zone')).toMatch(
      /, \d{1,2}:30\s?(AM|PM)$/,
    );
  });

  it('says a moment as a day and a minute, never with seconds', () => {
    const moment = houseMoment('2026-09-01T21:16:58Z', 'en-US', 'Asia/Beirut');
    expect(moment).toMatch(/^(Wed 2 Sep|2 Sep 2026), 12:16\s?AM$/);
    expect(moment).not.toContain(':58');
  });
});
