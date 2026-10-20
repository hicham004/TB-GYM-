import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  deviceTimeZoneId,
  searchTimeZones,
  timeZoneIds,
  timeZoneOption,
  zoneLabel,
} from './time-zones';

// A fixed instant: 9 October 2026, 16:00 UTC, when Beirut is on summer time (GMT+3).
const AT = new Date('2026-10-09T16:00:00Z');

describe('time zones as a person picks one', () => {
  afterEach(() => vi.restoreAllMocks());

  it('names a zone by its city and area, with its offset and the time there now', () => {
    const beirut = timeZoneOption('Asia/Beirut', AT, 'en-US');
    expect(beirut).toMatchObject({
      id: 'Asia/Beirut',
      city: 'Beirut',
      area: 'Asia',
      offset: 'GMT+3',
      offsetMinutes: 180,
      now: '7:00 PM',
    });
    expect(zoneLabel(beirut)).toBe('Beirut, Asia');
    const newYork = timeZoneOption('America/New_York', AT, 'en-US');
    expect(newYork).toMatchObject({ city: 'New York', offset: 'GMT-4', offsetMinutes: -240 });
    expect(timeZoneOption('Asia/Kolkata', AT, 'en-US').offsetMinutes).toBe(330);
    const utc = timeZoneOption('UTC', AT, 'en-US');
    expect(utc).toMatchObject({ city: 'UTC', area: '' });
    expect(zoneLabel(utc)).toBe('UTC');
  });

  it('always lists UTC and the saved zone, even one the browser does not', () => {
    const ids = timeZoneIds('Etc/GMT-3');
    expect(ids).toContain('Asia/Beirut');
    expect(ids).toContain('UTC');
    expect(ids).toContain('Etc/GMT-3');
  });

  it('finds zones by city, area or offset, the cities that start with it first', () => {
    const options = ['Asia/Beirut', 'Europe/Berlin', 'Asia/Dubai', 'America/Bahia', 'UTC'].map(
      (id) => timeZoneOption(id, AT, 'en-US'),
    );
    expect(searchTimeZones(options, 'be').map((option) => option.city)).toEqual([
      'Berlin',
      'Beirut',
    ]);
    expect(searchTimeZones(options, 'asia').map((option) => option.city)).toEqual([
      'Beirut',
      'Dubai',
    ]);
    expect(searchTimeZones(options, 'gmt+4').map((option) => option.city)).toEqual(['Dubai']);
    expect(searchTimeZones(options, 'nowhere')).toEqual([]);
    // With nothing typed, the list runs west to east, as a world clock does.
    expect(searchTimeZones(options, '').map((option) => option.city)).toEqual([
      'Bahia',
      'UTC',
      'Berlin',
      'Beirut',
      'Dubai',
    ]);
  });

  it('reads the device’s zone when it names a place or UTC, and nothing when it cannot', () => {
    const device = (timeZone: string) =>
      vi
        .spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions')
        .mockReturnValue({ timeZone } as Intl.ResolvedDateTimeFormatOptions);

    device('Asia/Dubai');
    expect(deviceTimeZoneId()).toBe('Asia/Dubai');
    device('UTC');
    expect(deviceTimeZoneId()).toBe('UTC');
    device('Etc/UTC');
    expect(deviceTimeZoneId()).toBe('UTC');
    device('Etc/Unknown');
    expect(deviceTimeZoneId()).toBeNull();
    device('');
    expect(deviceTimeZoneId()).toBeNull();
  });
});
